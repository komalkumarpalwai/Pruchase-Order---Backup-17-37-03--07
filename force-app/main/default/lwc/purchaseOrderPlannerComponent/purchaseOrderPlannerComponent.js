import { LightningElement, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getPurchaseRequisitionLines from '@salesforce/apex/PurchaseOrderPlanner.getPurchaseRequisitionLines';
import getLineDetails from '@salesforce/apex/PurchaseOrderPlanner.getLineDetails';
import getInventoryByItem from '@salesforce/apex/PurchaseOrderPlanner.getInventoryByItem';
import getContributingSRs from '@salesforce/apex/PurchaseOrderPlanner.getContributingSRs';
import getContributingPRLines from '@salesforce/apex/PurchaseOrderPlanner.getContributingPRLines';
import getDemandBreakdown from '@salesforce/apex/PurchaseOrderPlanner.getDemandBreakdown';
import getApprovedVendors from '@salesforce/apex/PurchaseOrderPlanner.getApprovedVendors';
import getPreferredVendor from '@salesforce/apex/PurchaseOrderPlanner.getPreferredVendor';
import getAllProductVendors from '@salesforce/apex/PurchaseOrderPlanner.getAllProductVendors';
import generatePurchaseOrders from '@salesforce/apex/PurchaseOrderPlanner.generatePurchaseOrders';
import generatePOsFromPRLines from '@salesforce/apex/PurchaseOrderPlanner.generatePOsFromPRLines';

export default class PurchaseOrderPlannerComponent extends NavigationMixin(LightningElement) {
    // ===== DATA =====
    @track allLines = [];
    @track filteredLines = [];
    @track selectedLineIds = new Set();
    @track selectedLineDetail = null;
    @track selectedLineInventory = null;
    @track selectedVendorId = null;
    @track selectedSRsMap = {}; // Tracks selected Supply Requests globally: { srId: parentLineId }
    @track preferredVendorMap = {};
    @track selectedVendorsByLine = {}; // Tracks selected vendors per Requisition Line: { lineId: Set of vendorIds }
    
    // ===== COMPONENT COMPARE STATE =====
    compareSelectedVendorIds = new Set();
    @track comparedVendors = [];
    @track isCompareModalOpen = false;
    @track selectedWinnerVendorId = '';
    @track isErrorModalOpen = false;
    @track errorModalMessage = '';
    @track isSuccessModalOpen = false;
    @track successModalMessage = '';
    @track successPOs = [];
    @track successCountdown = 7;
    countdownIntervalId = null;

    // ===== PANEL STATE =====
    isPanelOpen = false;
    activePanelLineId = null;
    activeTab = 'overview';
    isWorking = false;
    isLoading = true;
    isDemandSelectionApplied = true;

    // Tab order for keyboard navigation
    tabOrder = ['overview', 'contributingSRs', 'inventory', 'demandBreakdown', 'approvedVendors', 'vendorComparison'];

    // ===== FILTER STATE =====
    isFiltersOpen = false;
    filterVendor = '';
    filterItem = '';
    filterWarehouse = '';
    filterStatus = '';
    filterDateFrom = '';
    filterDateTo = '';

    // ===== SORTING & DEBOUNCE STATE =====
    sortBy = 'itemName';
    sortDirection = 'asc';
    delayTimeout;

    // ===== PAGINATION STATE =====
    currentPage = 1;
    pageSize = 5;

    // ===== TAB DATA =====
    @track contributingSRs = [];
    @track contributingPRLines = [];
    @track inventoryRecords = [];
    @track demandSRs = [];
    @track approvedVendors = [];

    // ===== COLLAPSIBLE STATE =====
    isContributingSRsExpanded = true;
    isContributingPRLinesExpanded = false;
    isNotesExpanded = false;
    isDemandPRLineExpanded = false;

    // ===== LIFECYCLE =====
    connectedCallback() {
        this.loadData();
    }

    // ===== DATA LOADING =====
    loadData() {
        this.isLoading = true;
        getPurchaseRequisitionLines()
            .then(result => {
                this.processLines(result);
            })
            .catch(error => {
                console.error('Error loading PR lines:', error);
            })
            .finally(() => {
                this.isLoading = false;
            });
    }

    processLines(data) {
        if (!data) return;

        // 1. Gather all unique item IDs
        const itemIds = [...new Set(data.map(line => line.Item__c || (line.Item__r ? line.Item__r.Id : null)).filter(id => !!id))];

        // 2. Fetch preferred vendors
        const prefPromises = data.map(line => {
            const itemId = line.Item__c || (line.Item__r ? line.Item__r.Id : null);
            if (itemId) {
                return getPreferredVendor({ itemId: itemId })
                    .then(vendors => {
                        if (vendors && vendors.length > 0) {
                            vendors.forEach(vendor => {
                                const vendorLocId = vendor.Inventory_Location__c || (vendor.Inventory_Location__r ? vendor.Inventory_Location__r.Id : null);
                                if (vendorLocId) {
                                    const key = itemId + '_' + vendorLocId;
                                    this.preferredVendorMap[key] = vendor;
                                } else {
                                    const key = itemId + '_global';
                                    this.preferredVendorMap[key] = vendor;
                                }
                            });
                        }
                    })
                    .catch(() => { /* no preferred vendor */ });
            }
            return Promise.resolve();
        });

        // 3. Fetch all approved/preferred product vendors to auto-select if there is exactly 1 vendor
        let allProductVendors = [];
        const approvedVendorsPromise = itemIds.length > 0
            ? getAllProductVendors({ itemIds: itemIds })
                .then(result => {
                    allProductVendors = result || [];
                })
                .catch(err => {
                    console.error('Error fetching all approved vendors:', err);
                })
            : Promise.resolve();

        Promise.all([...prefPromises, approvedVendorsPromise]).then(() => {
            this.allLines = data.map(line => {
                const itemId = line.Item__c || (line.Item__r ? line.Item__r.Id : null);
                const locationId = line.Inventory_Location__c || (line.Inventory_Location__r ? line.Inventory_Location__r.Id : null);

                // Find preferred vendor
                const prefVendor = this.preferredVendorMap[itemId + '_' + locationId]
                    || this.preferredVendorMap[itemId + '_global'];

                let selectedVendorName = '';
                let preferredVendorName = '';
                if (prefVendor && prefVendor.Vendor__r) {
                    selectedVendorName = prefVendor.Vendor__r.Name;
                    preferredVendorName = prefVendor.Vendor__r.Name;
                } else {
                    // Check if there is exactly one active approved vendor for this item & location
                    const lineVendors = allProductVendors.filter(v => {
                        const vItemId = v.Item__c || (v.Item__r ? v.Item__r.Id : null);
                        const vLocId = v.Inventory_Location__c || (v.Inventory_Location__r ? v.Inventory_Location__r.Id : null);
                        return vItemId === itemId && (vLocId === locationId || !vLocId);
                    });
                    if (lineVendors.length === 1 && lineVendors[0].Vendor__r) {
                        selectedVendorName = lineVendors[0].Vendor__r.Name;
                    }
                }

                return {
                    ...line,
                    itemName: line.Item__r ? line.Item__r.Name : '',
                    warehouseName: line.Inventory_Location__r ? line.Inventory_Location__r.Name : '',
                    vendorName: selectedVendorName,
                    preferredVendorName: preferredVendorName,
                    hasPreferredVendor: preferredVendorName && selectedVendorName === preferredVendorName,
                    requiredDate: line.Purchase_Requisition__r ? this.formatDate(line.Purchase_Requisition__r.Requested_Date__c) : '',
                    isSelected: this.selectedLineIds.has(line.Id),
                    rowClass: this.getRowClass(line.Id)
                };
            });
            this.applyFilters();
        });
    }

    // ===== FILTER HANDLERS =====
    get vendorOptions() {
        const options = [{ label: 'All', value: '' }];
        const vendors = new Set();
        this.allLines.forEach(line => {
            if (line.vendorName) vendors.add(line.vendorName);
        });
        vendors.forEach(v => options.push({ label: v, value: v }));
        return options;
    }

    get warehouseOptions() {
        const options = [{ label: 'All', value: '' }];
        const warehouses = new Set();
        this.allLines.forEach(line => {
            if (line.warehouseName) warehouses.add(line.warehouseName);
        });
        warehouses.forEach(w => options.push({ label: w, value: w }));
        return options;
    }

    get statusOptions() {
        return [
            { label: 'All', value: '' },
            { label: 'Open', value: 'Open' },
            { label: 'Partially Ordered', value: 'Partially Ordered' },
            { label: 'Fully Ordered', value: 'Fully Ordered' },
            { label: 'Cancelled', value: 'Cancelled' }
        ];
    }

    handleVendorFilter(event) {
        this.filterVendor = event.detail.value;
        this.applyFilters();
    }

    handleItemFilter(event) {
        this.filterItem = event.detail.value;
        this.debounceApplyFilters();
    }

    handleWarehouseFilter(event) {
        this.filterWarehouse = event.detail.value;
        this.applyFilters();
    }

    handleStatusFilter(event) {
        this.filterStatus = event.detail.value;
        this.applyFilters();
    }

    handleDateFromFilter(event) {
        this.filterDateFrom = event.detail.value;
        this.applyFilters();
    }

    handleDateToFilter(event) {
        this.filterDateTo = event.detail.value;
        this.applyFilters();
    }

    debounceApplyFilters() {
        window.clearTimeout(this.delayTimeout);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this.delayTimeout = window.setTimeout(() => {
            this.applyFilters();
        }, 300);
    }

    handleApplyFilters() {
        this.applyFilters();
    }

    handleClearFilters() {
        this.filterVendor = '';
        this.filterItem = '';
        this.filterWarehouse = '';
        this.filterStatus = '';
        this.filterDateFrom = '';
        this.filterDateTo = '';
        this.applyFilters();
    }

    handleToggleFilters() {
        this.isFiltersOpen = !this.isFiltersOpen;
    }

    get filterToggleLabel() {
        return this.isFiltersOpen ? 'Collapse' : 'Expand';
    }

    get filterToggleIcon() {
        return this.isFiltersOpen ? 'utility:chevronup' : 'utility:chevrondown';
    }

    get filterChevronIcon() {
        return this.isFiltersOpen ? 'utility:chevrondown' : 'utility:chevronright';
    }

    // ===== SORT HANDLERS & HELPERS =====
    handleSort(event) {
        const fieldName = event.currentTarget.dataset.name;
        if (this.sortBy === fieldName) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortBy = fieldName;
            this.sortDirection = 'asc';
        }
        this.applyFilters();
    }

    getSortValue(line, key) {
        if (key === 'requiredDate') {
            return line.Purchase_Requisition__r ? line.Purchase_Requisition__r.Requested_Date__c : '';
        }
        return line[key];
    }

    get itemSortIcon() { return this.sortBy === 'itemName' ? (this.sortDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown') : 'utility:sort'; }
    get warehouseSortIcon() { return this.sortBy === 'warehouseName' ? (this.sortDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown') : 'utility:sort'; }
    get qtySortIcon() { return this.sortBy === 'Requested_Qty__c' ? (this.sortDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown') : 'utility:sort'; }
    get vendorSortIcon() { return this.sortBy === 'vendorName' ? (this.sortDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown') : 'utility:sort'; }
    get preferredSortIcon() { return this.sortBy === 'hasPreferredVendor' ? (this.sortDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown') : 'utility:sort'; }
    get dateSortIcon() { return this.sortBy === 'requiredDate' ? (this.sortDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown') : 'utility:sort'; }

    get itemSortClass() { return this.sortBy === 'itemName' ? 'sort-icon active-sort' : 'sort-icon'; }
    get warehouseSortClass() { return this.sortBy === 'warehouseName' ? 'sort-icon active-sort' : 'sort-icon'; }
    get qtySortClass() { return this.sortBy === 'Requested_Qty__c' ? 'sort-icon active-sort' : 'sort-icon'; }
    get vendorSortClass() { return this.sortBy === 'vendorName' ? 'sort-icon active-sort' : 'sort-icon'; }
    get preferredSortClass() { return this.sortBy === 'hasPreferredVendor' ? 'sort-icon active-sort' : 'sort-icon'; }
    get dateSortClass() { return this.sortBy === 'requiredDate' ? 'sort-icon active-sort' : 'sort-icon'; }

    applyFilters(keepPage = false) {
        let result = [...this.allLines];

        if (this.filterVendor) {
            result = result.filter(l => l.vendorName === this.filterVendor);
        }
        if (this.filterItem) {
            const search = this.filterItem.toLowerCase();
            result = result.filter(l => l.itemName && l.itemName.toLowerCase().includes(search));
        }
        if (this.filterWarehouse) {
            result = result.filter(l => l.warehouseName === this.filterWarehouse);
        }
        if (this.filterStatus) {
            result = result.filter(l => l.Status__c === this.filterStatus);
        }
        if (this.filterDateFrom) {
            result = result.filter(l => {
                const reqDate = l.Purchase_Requisition__r ? l.Purchase_Requisition__r.Requested_Date__c : null;
                return reqDate && reqDate >= this.filterDateFrom;
            });
        }
        if (this.filterDateTo) {
            result = result.filter(l => {
                const reqDate = l.Purchase_Requisition__r ? l.Purchase_Requisition__r.Requested_Date__c : null;
                return reqDate && reqDate <= this.filterDateTo;
            });
        }

        // Apply sorting
        if (this.sortBy) {
            const key = this.sortBy;
            const reverse = this.sortDirection === 'desc' ? -1 : 1;
            result.sort((a, b) => {
                let valA = this.getSortValue(a, key);
                let valB = this.getSortValue(b, key);

                if (valA == null) valA = '';
                if (valB == null) valB = '';

                if (typeof valA === 'string') {
                    return valA.localeCompare(valB) * reverse;
                }
                if (typeof valA === 'number' || typeof valA === 'boolean') {
                    return (valA > valB ? 1 : valA < valB ? -1 : 0) * reverse;
                }
                return 0;
            });
        }

        this.filteredLines = result.map(line => ({
            ...line,
            isSelected: this.selectedLineIds.has(line.Id),
            rowClass: this.getRowClass(line.Id)
        }));

        // Reset pagination to page 1 when filters change (unless keepPage is true)
        if (!keepPage) {
            this.currentPage = 1;
        }
    }

    // ===== PAGINATION =====
    get paginatedLines() {
        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        return this.filteredLines.slice(start, end);
    }

    handlePageChange(event) {
        this.currentPage = event.detail.currentPage;
        this.pageSize = event.detail.pageSize;
    }

    // ===== SELECTION HANDLERS =====
    handleSelectAll(event) {
        const isChecked = event.target.checked;
        if (isChecked) {
            const promises = this.filteredLines.map(line => {
                this.selectedLineIds.add(line.Id);
                return getDemandBreakdown({ prLineId: line.Id })
                    .then(result => {
                        if (result && result.length > 0) {
                            result.forEach(sr => {
                                this.selectedSRsMap[sr.Id] = line.Id;
                            });
                        }
                    })
                    .catch(error => {
                        console.error('Error pre-selecting SRs:', error);
                    });
            });
            Promise.all(promises).then(() => {
                this.selectedSRsMap = { ...this.selectedSRsMap };
                this.selectedLineIds = new Set(this.selectedLineIds);
                this.refreshLineStates();
            });
        } else {
            this.filteredLines.forEach(line => {
                this.selectedLineIds.delete(line.Id);
                Object.keys(this.selectedSRsMap).forEach(srId => {
                    if (this.selectedSRsMap[srId] === line.Id) {
                        delete this.selectedSRsMap[srId];
                    }
                });
                delete this.selectedVendorsByLine[line.Id];
            });
            this.selectedSRsMap = { ...this.selectedSRsMap };
            this.selectedLineIds = new Set(this.selectedLineIds);
            this.refreshLineStates();
        }
    }

    handleRowSelect(event) {
        const lineId = event.target.dataset.id;
        const isChecked = event.target.checked;
        if (isChecked) {
            this.selectedLineIds.add(lineId);
            // We no longer automatically pre-select demand SRs here.
            // The user must explicitly select them in the Demand Breakdown tab.
        } else {
            this.selectedLineIds.delete(lineId);
            Object.keys(this.selectedSRsMap).forEach(srId => {
                if (this.selectedSRsMap[srId] === lineId) {
                    delete this.selectedSRsMap[srId];
                }
            });
            this.selectedSRsMap = { ...this.selectedSRsMap };
            delete this.selectedVendorsByLine[lineId];
        }
        this.selectedLineIds = new Set(this.selectedLineIds);
        this.refreshLineStates();
    }

    handleClearSelection() {
        this.selectedLineIds = new Set();
        this.selectedSRsMap = {};
        this.selectedVendorsByLine = {};
        this.refreshLineStates();
    }

    // Removed syncLineSelectionFromSRs to prevent automatic row unchecking

    refreshLineStates() {
        this.filteredLines = this.filteredLines.map(line => ({
            ...line,
            isSelected: this.selectedLineIds.has(line.Id),
            rowClass: this.getRowClass(line.Id)
        }));
    }

    getRowClass(lineId) {
        let cls = '';
        if (this.selectedLineIds.has(lineId)) {
            cls += ' selected-row';
        }
        if (this.activePanelLineId === lineId) {
            cls += ' active-panel-row';
        }
        return cls.trim();
    }

    // ===== COMPUTED PROPERTIES =====
    get isAllSelected() {
        return this.filteredLines.length > 0 &&
               this.filteredLines.every(line => this.selectedLineIds.has(line.Id));
    }

    get selectedCount() {
        return this.selectedLineIds.size;
    }

    get totalRecords() {
        return this.filteredLines.length;
    }

    get isClearSelectionDisabled() {
        return this.isWorking || !this.selectedLineIds || this.selectedLineIds.size === 0;
    }

    get isViewDetailsDisabled() {
        return this.isWorking || this.selectedLineIds.size === 0;
    }

    get isApplySelectionDisabled() {
        return this.isDemandSelectionApplied;
    }

    get demandApplyBtnClass() {
        return this.isDemandSelectionApplied
            ? 'demand-apply-btn demand-apply-btn-disabled'
            : 'demand-apply-btn demand-apply-btn-active';
    }

    get isGenerateDisabled() {
        if (this.isWorking) {
            return true;
        }

        const hasLinesSelected = this.selectedLineIds && this.selectedLineIds.size > 0;

        if (!hasLinesSelected) {
            return true;
        }

        const selectedSRValues = Object.values(this.selectedSRsMap);
        const selectedLines = this.allLines.filter(line => this.selectedLineIds.has(line.Id));

        for (const line of selectedLines) {
            if (!line.vendorName || line.vendorName === '—' || line.vendorName === '') {
                return true;
            }
            const hasSelectedSR = selectedSRValues.includes(line.Id);
            if (!hasSelectedSR) {
                return true;
            }
        }

        return false;
    }

    get generateButtonTitle() {
        if (this.isWorking) {
            return 'Generating Purchase Orders...';
        }
        if (this.isGenerateDisabled) {
            return 'Please select demand and vendor';
        }
        return 'Generate Purchase Orders';
    }

    get totalRequestedQty() {
        let total = 0;
        this.filteredLines.forEach(line => {
            if (this.selectedLineIds.has(line.Id)) {
                total += (line.Requested_Qty__c || 0);
            }
        });
        return total;
    }

    get uniqueVendorCount() {
        const vendors = new Set();
        this.filteredLines.forEach(line => {
            if (this.selectedLineIds.has(line.Id) && line.vendorName) {
                vendors.add(line.vendorName);
            }
        });
        return vendors.size;
    }

    get uniqueWarehouseCount() {
        const warehouses = new Set();
        this.filteredLines.forEach(line => {
            if (this.selectedLineIds.has(line.Id) && line.warehouseName) {
                warehouses.add(line.warehouseName);
            }
        });
        return warehouses.size;
    }

    get progressBarStyle() {
        if (this.filteredLines.length === 0) return 'width: 0%';
        const pct = (this.selectedLineIds.size / this.filteredLines.length) * 100;
        return `width: ${pct}%`;
    }

    // ===== LAYOUT CLASSES =====
    get mainContainerClass() {
        return this.isPanelOpen ? 'main-container panel-open' : 'main-container';
    }

    get leftSectionClass() {
        return this.isPanelOpen ? 'left-section panel-open' : 'left-section';
    }

    // ===== PANEL HANDLERS =====
    handleMoreActions(event) {
        event.preventDefault();
        const lineId = event.target.dataset.id || event.currentTarget.dataset.id;
        this.activePanelLineId = lineId;
        this.isPanelOpen = true;
        this.activeTab = 'overview';
        this.loadPanelData(lineId);
        this.refreshLineStates();
    }

    handleItemClick(event) {
        event.preventDefault();
        const lineId = event.target.dataset.id || event.currentTarget.dataset.id;
        this.activePanelLineId = lineId;
        this.isPanelOpen = true;
        this.activeTab = 'overview';
        this.loadPanelData(lineId);
        this.refreshLineStates();
    }

    handleClosePanel() {
        this.isPanelOpen = false;
        this.activePanelLineId = null;
        this.selectedLineDetail = null;
        this.refreshLineStates();
    }

    handleViewDetails() {
        // Open panel for the first selected line
        const firstSelectedId = [...this.selectedLineIds][0];
        if (firstSelectedId) {
            this.activePanelLineId = firstSelectedId;
            this.isPanelOpen = true;
            this.activeTab = 'overview';
            this.loadPanelData(firstSelectedId);
            this.refreshLineStates();
        }
    }

    handleGeneratePO() {
        // Validate multiple vendors selected per Requisition Line
        for (const lineId of this.selectedLineIds) {
            const lineVendors = this.selectedVendorsByLine[lineId];
            if (lineVendors && lineVendors.size > 1) {
                const line = this.allLines.find(l => l.Id === lineId);
                const lineName = line ? line.itemName : 'Requisition Line';
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: 'Invalid Vendor Selection',
                        message: `Multiple vendors are selected for Requisition Line: ${lineName}. Please select only one vendor.`,
                        variant: 'error',
                        mode: 'sticky'
                    })
                );
                return;
            }
        }

        const manualVendorMap = {};
        Object.keys(this.selectedVendorsByLine).forEach(lineId => {
            const vendorSet = this.selectedVendorsByLine[lineId];
            if (vendorSet && vendorSet.size === 1) {
                manualVendorMap[lineId] = [...vendorSet][0];
            }
        });

        const srIds = Object.keys(this.selectedSRsMap).filter(srId => {
            const lineId = this.selectedSRsMap[srId];
            return this.selectedLineIds.has(lineId);
        });

        if (srIds.length === 0) {
            // Check if user has selected lines on the main grid
            const selectedLineIdsList = Array.from(this.selectedLineIds);
            if (selectedLineIdsList.length > 0) {
                this.isWorking = true;
                generatePOsFromPRLines({ prLineIds: selectedLineIdsList, manualVendorMap: manualVendorMap })
                    .then(result => {
                        this.isWorking = false;
                        if (result && result.success) {
                            this.selectedLineIds = new Set();
                            this.selectedSRsMap = {};
                            this.selectedVendorsByLine = {};
                            this.showSuccessModal(result);
                        } else if (result && result.isDuplicate) {
                            this.errorModalMessage = result.message;
                            this.isErrorModalOpen = true;
                        } else {
                            this.dispatchEvent(
                                new ShowToastEvent({
                                    title: 'Generation Failed',
                                    message: result.message || 'An unknown error occurred.',
                                    variant: 'error',
                                    mode: 'sticky'
                                })
                            );
                        }
                    })
                    .catch(error => {
                        this.isWorking = false;
                        console.error('Error generating POs:', error);
                        this.dispatchEvent(
                            new ShowToastEvent({
                                        title: 'Error',
                                        message: error.body?.message || 'A network error occurred while generating Purchase Orders.',
                                        variant: 'error',
                                        mode: 'sticky'
                                    })
                                );
                            });
            } else {
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: 'No Selection',
                        message: 'Please select one or more PR Lines in the grid or Supply Requests in the Demand Breakdown tab to generate Purchase Orders.',
                        variant: 'warning'
                    })
                );
            }
            return;
        }

        // Generate from selected Supply Requests
        this.isWorking = true;
        generatePurchaseOrders({ supplyRequestIds: srIds, manualVendorMap: manualVendorMap })
            .then(result => {
                this.isWorking = false;
                if (result && result.success) {
                    this.selectedLineIds = new Set();
                    this.selectedSRsMap = {};
                    this.selectedVendorsByLine = {};
                    this.showSuccessModal(result);
                } else if (result && result.isDuplicate) {
                    this.errorModalMessage = result.message;
                    this.isErrorModalOpen = true;
                } else {
                    this.dispatchEvent(
                        new ShowToastEvent({
                            title: 'Generation Failed',
                            message: result.message || 'An unknown error occurred.',
                            variant: 'error',
                            mode: 'sticky'
                        })
                    );
                }
            })
            .catch(error => {
                this.isWorking = false;
                console.error('Error generating POs:', error);
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: 'Error',
                        message: error.body?.message || 'A network error occurred while generating Purchase Orders.',
                        variant: 'error',
                        mode: 'sticky'
                    })
                );
            });
    }

    handleRefresh() {
        this.selectedLineIds = new Set();
        this.isPanelOpen = false;
        this.activePanelLineId = null;
        this.selectedLineDetail = null;
        this.loadData();
    }

    handleCloseErrorModal() {
        this.isErrorModalOpen = false;
        this.errorModalMessage = '';
    }

    handleCloseErrorModalAndRefresh() {
        this.isErrorModalOpen = false;
        this.errorModalMessage = '';
        this.handleRefresh();
    }

    showSuccessModal(result) {
        this.successModalMessage = result.message;
        const pos = result.pos || [];
        const polis = result.polis || [];
        const poas = result.poas || [];

        // Build the tree hierarchy: PO -> POLIs -> POAs
        this.successPOs = pos.map(po => {
            const poPolis = polis.filter(poli => poli.Purchase_Order__c === po.Id).map(poli => {
                const poliPoas = poas.filter(poa => poa.Purchase_Order_Line_Item__c === poli.Id);
                return {
                    ...poli,
                    poas: poliPoas
                };
            });
            return {
                ...po,
                polis: poPolis
            };
        });

        this.successCountdown = 7;
        this.isSuccessModalOpen = true;

        if (this.countdownIntervalId) {
            clearInterval(this.countdownIntervalId);
        }

        this.countdownIntervalId = setInterval(() => {
            this.successCountdown -= 1;
            if (this.successCountdown <= 0) {
                this.handleCloseSuccessModal();
            }
        }, 1000);
    }

    handleCloseSuccessModal() {
        this.isSuccessModalOpen = false;
        if (this.countdownIntervalId) {
            clearInterval(this.countdownIntervalId);
            this.countdownIntervalId = null;
        }
        this.handleRefresh();
    }

    loadPanelData(lineId) {
        this.selectedLineDetail = null;

        getLineDetails({ prLineId: lineId })
            .then(result => {
                this.selectedLineDetail = result;
                // Load tab-specific data
                const itemId = result ? (result.Item__c || (result.Item__r ? result.Item__r.Id : null)) : null;
                if (result && itemId) {
                    this.loadTabData(result);
                }
            })
            .catch(error => {
                console.error('Error loading line details:', error);
            });
    }

    loadTabData(lineDetail) {
        const itemId = lineDetail.Item__c || (lineDetail.Item__r ? lineDetail.Item__r.Id : null);
        const prId = lineDetail.Purchase_Requisition__c || (lineDetail.Purchase_Requisition__r ? lineDetail.Purchase_Requisition__r.Id : null);
        const locationId = lineDetail.Inventory_Location__c || (lineDetail.Inventory_Location__r ? lineDetail.Inventory_Location__r.Id : null);

        // Load Contributing SRs
        getContributingSRs({ prLineId: lineDetail.Id })
            .then(result => {
                this.contributingSRs = (result || []).map(sr => ({
                    ...sr,
                    isOpen: sr.Status__c === 'Open',
                    statusClass: sr.Status__c === 'Open' ? 'status-pill-open' : 'status-pill-other'
                }));
            })
            .catch(error => {
                console.error('Error loading contributing SRs:', error);
                this.contributingSRs = [];
            });

        // Load Contributing PR Lines
        if (prId) {
            getContributingPRLines({ purchaseRequisitionId: prId, itemId: itemId })
                .then(result => {
                    this.contributingPRLines = (result || []).map(prLine => ({
                        ...prLine,
                        isOpen: prLine.Status__c === 'Open',
                        statusClass: prLine.Status__c === 'Open' ? 'status-pill-open' : 'status-pill-other'
                    }));
                })
                .catch(error => {
                    console.error('Error loading contributing PR Lines:', error);
                    this.contributingPRLines = [];
                });
        }

        // Load Inventory
        getInventoryByItem({ itemId: itemId })
            .then(result => {
                const currentLocationId = locationId;
                const matchingInv = (result || []).find(inv => {
                    const invLocId = inv.Inventory_Location__c || (inv.Inventory_Location__r ? inv.Inventory_Location__r.Id : null);
                    return invLocId === currentLocationId;
                });
                const currentInvId = matchingInv ? matchingInv.Id : null;
                this.selectedLineInventory = matchingInv || null;

                this.inventoryRecords = (result || []).map(inv => {
                    const isSelectedLocation = inv.Id === currentInvId;
                    const av = inv.Available__c ?? 0;
                    const oh = inv.On_Hand_Qty__c ?? 0;
                    const res = inv.Reserved__c ?? 0;
                    
                    let availableClass = 'inv-badge';
                    let healthBarClass = 'health-bar-fill';
                    let healthBarWidth = 0;
                    let showWarningIcon = false;

                    if (av > 0) {
                        availableClass += ' badge-green';
                        healthBarClass += ' health-green';
                        healthBarWidth = oh > 0 ? Math.round((av / oh) * 100) : 0;
                    } else if (res >= oh && oh > 0) {
                        availableClass += ' badge-red';
                        healthBarClass += ' health-red';
                        healthBarWidth = 0;
                        showWarningIcon = true;
                    } else {
                        availableClass += ' badge-orange';
                        healthBarClass += ' health-orange';
                        healthBarWidth = 30; // Represented as low availability (e.g. 30% fill)
                    }

                    return {
                        ...inv,
                        rowClass: (isSelectedLocation ? 'current-location-row ' : '') + (res >= oh && oh > 0 ? 'critical-row' : ''),
                        availableClass: availableClass,
                        healthBarClass: healthBarClass,
                        healthBarWidthStyle: `width: ${healthBarWidth}%`,
                        showWarningIcon: showWarningIcon
                    };
                });
            })
            .catch(error => {
                console.error('Error loading inventory:', error);
                this.inventoryRecords = [];
                this.selectedLineInventory = null;
            });

        // Load Demand Breakdown SRs
        getDemandBreakdown({ prLineId: lineDetail.Id })
            .then(result => {
                this.demandSRs = (result || []).map(sr => {
                    const isOrdered = sr.Status__c === 'Ordered';
                    const isSelected = !isOrdered && !!this.selectedSRsMap[sr.Id];
                    return {
                        ...sr,
                        isOrdered: isOrdered,
                        isSelected: isSelected,
                        includedQty: isSelected ? sr.Requested_Qty__c : 0,
                        rowClass: isOrdered ? 'ordered-demand-row' : (isSelected ? 'selected-demand-row' : '')
                    };
                });
                this.isDemandSelectionApplied = true;
            })
            .catch(error => {
                console.error('Error loading demand breakdown:', error);
                this.demandSRs = [];
            });

        // Load Approved Vendors
        this.compareSelectedVendorIds = this.selectedVendorsByLine[lineDetail.Id] || new Set();
        getApprovedVendors({ itemId: itemId, locationId: locationId })
            .then(result => {
                this.approvedVendors = (result || []).map(vendor => {
                    const ratingInfo = this.getPerformanceRating(vendor.Performance_Score__c);
                    const formattedPrice = vendor.Last_Purchase_Price__c != null ? vendor.Last_Purchase_Price__c.toFixed(2) : '—';
                    return {
                        ...vendor,
                        formattedPrice: formattedPrice,
                        performanceRating: vendor.Performance_Rating__c || ratingInfo.rating,
                        performanceClass: ratingInfo.class,
                        compareSelected: this.compareSelectedVendorIds.has(vendor.Id),
                        formattedReviewDate: vendor.Last_Reviewed_Date__c ? this.formatDate(vendor.Last_Reviewed_Date__c) : '—'
                    };
                });

                if (this.approvedVendors.length > 0) {
                    const preferred = this.approvedVendors.find(v => v.Is_Preferred__c);
                    this.selectedVendorId = preferred ? preferred.Id : this.approvedVendors[0].Id;
                } else {
                    this.selectedVendorId = null;
                }
            })
            .catch(error => {
                console.error('Error loading approved vendors:', error);
                this.approvedVendors = [];
                this.selectedVendorId = null;
            });
    }

    // ===== TAB HANDLERS =====
    handleTabClick(event) {
        this.activeTab = event.target.dataset.tab || event.currentTarget.dataset.tab;
        this.scrollActiveTabToCenter(event.target.closest('.tab-btn') || event.target);
    }

    handleTabKeyDown(event) {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            const currentIndex = this.tabOrder.indexOf(this.activeTab);
            let newIndex;
            if (event.key === 'ArrowRight') {
                newIndex = (currentIndex + 1) % this.tabOrder.length;
            } else {
                newIndex = (currentIndex - 1 + this.tabOrder.length) % this.tabOrder.length;
            }
            this.activeTab = this.tabOrder[newIndex];
            // Focus and scroll the new active tab button
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => {
                const btns = this.template.querySelectorAll('.tab-btn');
                if (btns[newIndex]) {
                    btns[newIndex].focus();
                    this.scrollActiveTabToCenter(btns[newIndex]);
                }
            });
        }
    }

    scrollActiveTabToCenter(btn) {
        const container = this.template.querySelector('.panel-tabs');
        if (btn && container) {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => {
                const btnLeft = btn.offsetLeft;
                const btnWidth = btn.offsetWidth;
                const containerWidth = container.offsetWidth;
                const scrollTarget = btnLeft - (containerWidth / 2) + (btnWidth / 2);
                container.scrollTo({ left: scrollTarget, behavior: 'smooth' });
            });
        }
    }

    // ===== TABLE EMPTY STATE =====
    get hasNoFilteredLines() {
        return !this.isLoading && this.filteredLines.length === 0;
    }

    get hasFilteredLines() {
        return this.filteredLines.length > 0;
    }

    get showPagination() {
        return this.filteredLines.length > 5;
    }

    get isOverviewTab() { return this.activeTab === 'overview'; }
    get isContributingSRsTab() { return this.activeTab === 'contributingSRs'; }
    get isInventoryTab() { return this.activeTab === 'inventory'; }
    get isDemandBreakdownTab() { return this.activeTab === 'demandBreakdown'; }
    get isApprovedVendorsTab() { return this.activeTab === 'approvedVendors'; }
    get isVendorComparisonTab() { return this.activeTab === 'vendorComparison'; }

    get hasApprovedVendors() { return this.approvedVendors && this.approvedVendors.length > 0; }

    // Tab active classes
    get overviewTabClass() { return this.activeTab === 'overview' ? 'tab-btn active' : 'tab-btn'; }
    get contributingSRsTabClass() { return this.activeTab === 'contributingSRs' ? 'tab-btn active' : 'tab-btn'; }
    get inventoryTabClass() { return this.activeTab === 'inventory' ? 'tab-btn active' : 'tab-btn'; }
    get demandBreakdownTabClass() { return this.activeTab === 'demandBreakdown' ? 'tab-btn active' : 'tab-btn'; }
    get approvedVendorsTabClass() { return this.activeTab === 'approvedVendors' ? 'tab-btn active' : 'tab-btn'; }
    get vendorComparisonTabClass() { return this.activeTab === 'vendorComparison' ? 'tab-btn active' : 'tab-btn'; }

    // ===== PANEL COMPUTED PROPERTIES =====
    get panelTitle() {
        if (!this.selectedLineDetail) return '';
        const itemName = this.selectedLineDetail.Item__r ? this.selectedLineDetail.Item__r.Name : '';
        const warehouse = this.selectedLineDetail.Inventory_Location__r ? this.selectedLineDetail.Inventory_Location__r.Name : '';
        return `${itemName} – ${warehouse}`;
    }

    get statusBadgeClass() {
        if (!this.selectedLineDetail) return '';
        const status = this.selectedLineDetail.Status__c;
        if (status === 'Open') return 'status-open';
        if (status === 'Partially Ordered') return 'status-partial';
        if (status === 'Fully Ordered') return 'status-ordered';
        if (status === 'Cancelled') return 'status-cancelled';
        return '';
    }

    // Overview tab fields
    get itemName() { return this.selectedLineDetail?.Item__r?.Name || '—'; }
    get itemCode() { return this.selectedLineDetail?.Item__r?.Item_Code__c || '—'; }
    get itemDescription() { return this.selectedLineDetail?.Item__r?.Item_Description__c || '—'; }
    get itemFamily() { return this.selectedLineDetail?.Item__r?.Item_Family__c || '—'; }
    get itemUOM() { return this.selectedLineDetail?.Item__r?.Unit_Of_Measure__c || '—'; }
    get itemSupplyMethod() { return this.selectedLineDetail?.Item__r?.Default_Supply_Method__c || '—'; }
    get inventoryLocation() { return this.selectedLineDetail?.Inventory_Location__r?.Name || '—'; }
    get availableQty() { return this.selectedLineInventory?.Available__c ?? '—'; }
    get availableQtyFormatted() {
        if (!this.selectedLineInventory) return '—';
        const av = this.selectedLineInventory.Available__c ?? 0;
        const oh = this.selectedLineInventory.On_Hand_Qty__c ?? 0;
        const pct = oh > 0 ? Math.round((av / oh) * 100) : 0;
        return `${av} (${pct}%)`;
    }
    get onHandQty() { return this.selectedLineInventory?.On_Hand_Qty__c ?? '—'; }
    get reservedQty() { return this.selectedLineInventory?.Reserved__c ?? '—'; }
    get prName() { return this.selectedLineDetail?.Purchase_Requisition__r?.PR_No__c || this.selectedLineDetail?.Purchase_Requisition__r?.Name || '—'; }
    get prRequestedDate() {
        const dt = this.selectedLineDetail?.Purchase_Requisition__r?.Requested_Date__c;
        return dt ? this.formatDate(dt) : '—';
    }

    get relativeRequiredDateForLine() {
        const dtStr = this.selectedLineDetail?.Purchase_Requisition__r?.Requested_Date__c;
        if (!dtStr) return null;
        try {
            const today = new Date(); today.setHours(0,0,0,0);
            const reqDate = new Date(dtStr); reqDate.setHours(0,0,0,0);
            const diffDays = Math.ceil((reqDate - today) / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'In 1 day';
            if (diffDays === -1) return 'Yesterday';
            if (diffDays > 1) return `In ${diffDays} days`;
            return `${Math.abs(diffDays)} days ago`;
        } catch(e) { return null; }
    }

    get selectedLineStatusClass() {
        if (!this.selectedLineDetail) return 'status-pill-open';
        const s = this.selectedLineDetail.Status__c;
        if (s === 'Open') return 'status-pill-open';
        if (s === 'Partially Ordered') return 'status-pill-partial';
        if (s === 'Fully Ordered') return 'status-pill-ordered';
        if (s === 'Cancelled') return 'status-pill-cancelled';
        return 'status-pill-other';
    }

    get selectedLineIsOpen() {
        return this.selectedLineDetail?.Status__c === 'Open';
    }

    get itemFamilyBadgeClass() {
        const f = this.selectedLineDetail?.Item__r?.Item_Family__c || '';
        if (f === 'Finished Good' || f === 'Finished Goods') return 'item-family-badge badge-green';
        if (f === 'Raw Material') return 'item-family-badge badge-orange';
        if (f === 'Semi-Finished') return 'item-family-badge badge-blue';
        return 'item-family-badge badge-default';
    }

    get stockHealthLabel() {
        if (!this.selectedLineInventory) return 'Unknown';
        const av = this.selectedLineInventory.Available__c ?? 0;
        const oh = this.selectedLineInventory.On_Hand_Qty__c ?? 0;
        if (av <= 0) return 'Critical';
        const pct = oh > 0 ? (av / oh) * 100 : 0;
        if (pct < 20) return 'Low';
        if (pct < 50) return 'Moderate';
        return 'Healthy';
    }

    get stockHealthClass() {
        const h = this.stockHealthLabel;
        if (h === 'Critical') return 'health-badge health-critical';
        if (h === 'Low') return 'health-badge health-low';
        if (h === 'Moderate') return 'health-badge health-moderate';
        return 'health-badge health-good';
    }

    get availableQtyPct() {
        if (!this.selectedLineInventory) return 0;
        const av = this.selectedLineInventory.Available__c ?? 0;
        const oh = this.selectedLineInventory.On_Hand_Qty__c ?? 0;
        return oh > 0 ? Math.round((av / oh) * 100) : 0;
    }

    get availableQtyDisplay() {
        const av = this.availableQty;
        const pct = this.availableQtyPct;
        return `${av} (${pct}%)`;
    }

    get otherLocationsCount() {
        return this.inventoryRecords ? Math.max(0, this.inventoryRecords.length - 1) : 0;
    }

    get hasOtherLocations() {
        return this.otherLocationsCount > 0;
    }

    get otherLocationsText() {
        const c = this.otherLocationsCount;
        return `This item is available at ${c} other location${c !== 1 ? 's' : ''}.`;
    }

    handleViewAllInventory(event) {
        event.preventDefault();
        this.activeTab = 'inventory';
    }


    // Contributing SRs
    get preferredVendorName() {
        if (!this.selectedLineDetail) return '—';
        const itemId = this.selectedLineDetail.Item__c || (this.selectedLineDetail.Item__r ? this.selectedLineDetail.Item__r.Id : null);
        const locationId = this.selectedLineDetail.Inventory_Location__c || (this.selectedLineDetail.Inventory_Location__r ? this.selectedLineDetail.Inventory_Location__r.Id : null);
        const prefVendor = this.preferredVendorMap[itemId + '_' + locationId]
            || this.preferredVendorMap[itemId + '_global'];
        return prefVendor ? prefVendor.Vendor__r.Name : '—';
    }

    get hasPreferredVendorDetail() {
        return this.preferredVendorName !== '—';
    }

    get relativeRequiredDate() {
        const dtStr = this.selectedLineDetail?.Purchase_Requisition__r?.Requested_Date__c;
        if (!dtStr) return '—';
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const reqDate = new Date(dtStr);
            reqDate.setHours(0, 0, 0, 0);
            const diffTime = reqDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'In 1 day';
            if (diffDays === -1) return 'Yesterday';
            if (diffDays > 1) return `In ${diffDays} days`;
            if (diffDays < -1) return `${Math.abs(diffDays)} days ago`;
            return '—';
        } catch (e) {
            return '—';
        }
    }

    get contributingSRsCountText() {
        const len = this.contributingSRs.length;
        return len === 1 ? '1 Record' : `${len} Records`;
    }

    get contributingPRLinesCountText() {
        const len = this.contributingPRLines.length;
        return len === 1 ? '1 Record' : `${len} Records`;
    }

    get contributingSRsCount() { return this.contributingSRs.length; }
    get hasContributingSRs() { return this.contributingSRs.length > 0; }
    get contributingSRsChevron() { return this.isContributingSRsExpanded ? 'utility:chevronup' : 'utility:chevrondown'; }

    get contributingPRLinesCount() { return this.contributingPRLines.length; }
    get hasContributingPRLines() { return this.contributingPRLines.length > 0; }
    get contributingPRLinesChevron() { return this.isContributingPRLinesExpanded ? 'utility:chevronup' : 'utility:chevrondown'; }

    get notesChevron() { return this.isNotesExpanded ? 'utility:chevronup' : 'utility:chevrondown'; }

    // Inventory
    get hasInventoryRecords() { return this.inventoryRecords.length > 0; }

    // Demand Breakdown
    get demandSRsCount() { return this.demandSRs.length; }
    get hasDemandSRs() { return this.demandSRs.length > 0; }
    get demandPRLineChevron() { return this.isDemandPRLineExpanded ? 'utility:chevronup' : 'utility:chevrondown'; }

    get remainingQtyTotal() {
        let total = 0;
        this.demandSRs.forEach(sr => {
            if (sr.Status__c !== 'Ordered') {
                total += (sr.Requested_Qty__c || 0);
            }
        });
        return total;
    }

    get demandSelectedQty() {
        let total = 0;
        this.demandSRs.forEach(sr => {
            if (sr.isSelected) {
                total += (sr.includedQty || 0);
            }
        });
        return total;
    }

    get demandSelectedSRsCount() {
        return this.demandSRs.filter(sr => sr.isSelected).length;
    }

    // Approved Vendors
    get hasApprovedVendors() { return this.approvedVendors.length > 0; }
    get hasMultipleVendors() { return this.approvedVendors.length > 1; }
    get hasOnlyOneVendor() { return this.approvedVendors.length === 1; }

    get approvedVendorsList() {
        return this.approvedVendors.map(vendor => ({
            ...vendor,
            rowClass: vendor.Id === this.selectedVendorId ? 'selected-vendor-row' : '',
            compareSelected: this.compareSelectedVendorIds.has(vendor.Id)
        }));
    }

    get selectedVendorDetail() {
        if (!this.selectedVendorId || this.approvedVendors.length === 0) return null;
        return this.approvedVendors.find(v => v.Id === this.selectedVendorId);
    }

    handleVendorSelect(event) {
        // Prevent selection changing when clicking the checkbox or vendor link
        if (event.target.tagName === 'LIGHTNING-INPUT' || event.target.closest('lightning-input') || event.target.classList.contains('vendor-name-link')) {
            return;
        }
        const vendorId = event.currentTarget.dataset.id;
        if (this.selectedVendorId === vendorId) {
            this.selectedVendorId = null;
        } else {
            this.selectedVendorId = vendorId;
        }
    }

    // ===== VENDOR COMPARE HANDLERS =====
    get showCompareButton() {
        return this.approvedVendors.length > 1 && this.compareSelectedVendorIds.size > 0;
    }

    get compareButtonLabel() {
        return `Compare Vendors (${this.compareSelectedVendorIds.size})`;
    }

    get isAllCompareSelected() {
        if (!this.approvedVendors || this.approvedVendors.length === 0) {
            return false;
        }
        return this.approvedVendors.every(v => this.compareSelectedVendorIds.has(v.Id));
    }

    handleCompareSelectAllChange(event) {
        event.stopPropagation();
        const checked = event.target.checked;
        const lineId = this.selectedLineDetail ? this.selectedLineDetail.Id : null;
        if (!lineId || !this.approvedVendors || this.approvedVendors.length === 0) return;

        if (!this.selectedVendorsByLine[lineId]) {
            this.selectedVendorsByLine[lineId] = new Set();
        }

        this.approvedVendors.forEach(vendor => {
            if (checked) {
                this.selectedVendorsByLine[lineId].add(vendor.Id);
                this.compareSelectedVendorIds.add(vendor.Id);
            } else {
                this.selectedVendorsByLine[lineId].delete(vendor.Id);
                this.compareSelectedVendorIds.delete(vendor.Id);
            }
        });

        // Trigger reactivity
        this.selectedVendorsByLine = { ...this.selectedVendorsByLine };
        this.compareSelectedVendorIds = new Set(this.compareSelectedVendorIds);

        // Update consolidated vendor selection info (similar to handleCompareCheckboxChange)
        const checkedVendorIds = this.selectedVendorsByLine[lineId];
        if (checkedVendorIds && checkedVendorIds.size === 1) {
            const selectedVendorId = [...checkedVendorIds][0];
            const selectedVendor = this.approvedVendors.find(v => v.Id === selectedVendorId);
            if (selectedVendor) {
                this.allLines = this.allLines.map(line => {
                    if (line.Id === lineId) {
                        return {
                            ...line,
                            vendorName: selectedVendor.Vendor__r.Name
                        };
                    }
                    return line;
                });
                this.applyFilters(true);
            }
        } else {
            this.allLines = this.allLines.map(line => {
                if (line.Id === lineId) {
                    const itemId = line.Item__c || (line.Item__r ? line.Item__r.Id : null);
                    const locationId = line.Inventory_Location__c || (line.Inventory_Location__r ? line.Inventory_Location__r.Id : null);
                    const preferredVendor = this.preferredVendorMap[itemId];
                    let defaultVendorName = 'Not Set';
                    if (preferredVendor) {
                        defaultVendorName = preferredVendor.Vendor__r.Name;
                    }
                    return {
                        ...line,
                        vendorName: defaultVendorName
                    };
                }
                return line;
            });
            this.applyFilters(true);
        }
    }

    handleCompareCheckboxChange(event) {
        event.stopPropagation();
        const id = event.target.dataset.id;
        const checked = event.target.checked;
        const lineId = this.selectedLineDetail ? this.selectedLineDetail.Id : null;

        if (lineId) {
            if (!this.selectedVendorsByLine[lineId]) {
                this.selectedVendorsByLine[lineId] = new Set();
            }

            if (checked) {
                this.selectedVendorsByLine[lineId].add(id);
                this.compareSelectedVendorIds.add(id);
            } else {
                this.selectedVendorsByLine[lineId].delete(id);
                this.compareSelectedVendorIds.delete(id);
            }

            const checkedVendorIds = this.selectedVendorsByLine[lineId];
            if (checkedVendorIds && checkedVendorIds.size === 1) {
                const selectedVendorId = [...checkedVendorIds][0];
                const selectedVendor = this.approvedVendors.find(v => v.Id === selectedVendorId);
                if (selectedVendor) {
                    this.allLines = this.allLines.map(line => {
                        if (line.Id === lineId) {
                            return {
                                ...line,
                                vendorName: selectedVendor.Vendor__r.Name
                            };
                        }
                        return line;
                    });
                    this.applyFilters(true);
                }
            } else {
                this.allLines = this.allLines.map(line => {
                    if (line.Id === lineId) {
                        const itemId = line.Item__c || (line.Item__r ? line.Item__r.Id : null);
                        const locationId = line.Inventory_Location__c || (line.Inventory_Location__r ? line.Inventory_Location__r.Id : null);
                        const prefVendor = this.preferredVendorMap[itemId + '_' + locationId]
                            || this.preferredVendorMap[itemId + '_global'];
                        const prefVendorName = prefVendor && prefVendor.Vendor__r ? prefVendor.Vendor__r.Name : '';
                        return {
                            ...line,
                            vendorName: prefVendorName,
                            hasPreferredVendor: !!prefVendorName
                        };
                    }
                    return line;
                });
                this.applyFilters(true);
            }
        }

        // Trigger reactivity
        this.approvedVendors = this.approvedVendors.map(v => ({
            ...v,
            compareSelected: this.compareSelectedVendorIds.has(v.Id)
        }));
    }

    handleOpenCompareModal() {
        this.comparedVendors = this.approvedVendors.filter(v => this.compareSelectedVendorIds.has(v.Id)).map(vendor => {
            return {
                ...vendor
            };
        });

        if (this.comparedVendors.length > 0) {
            const preferred = this.comparedVendors.find(v => v.Is_Preferred__c);
            this.selectedWinnerVendorId = preferred ? preferred.Id : this.comparedVendors[0].Id;
            this.activeTab = 'vendorComparison'; // Redirect to Vendor Comparison tab
        }
    }

    handleCancelComparison() {
        this.activeTab = 'approvedVendors'; // Switch back to Approved Vendors tab
    }

    handleCompareModalCheckboxChange(event) {
        const id = event.target.dataset.id;
        const checked = event.target.checked;
        if (!checked) {
            this.comparedVendors = this.comparedVendors.filter(v => v.Id !== id);
            this.compareSelectedVendorIds.delete(id);
            if (this.comparedVendors.length === 0) {
                this.activeTab = 'approvedVendors';
            } else {
                if (this.selectedWinnerVendorId === id) {
                    const preferred = this.comparedVendors.find(v => v.Is_Preferred__c);
                    this.selectedWinnerVendorId = preferred ? preferred.Id : this.comparedVendors[0].Id;
                }
            }
            this.approvedVendors = [...this.approvedVendors];
        }
    }

    handleWinnerRadioChange(event) {
        this.selectedWinnerVendorId = event.target.value;
    }

    handleSelectWinner() {
        if (!this.selectedWinnerVendorId) return;
        const winner = this.comparedVendors.find(v => v.Id === this.selectedWinnerVendorId);
        if (winner) {
            const evt = new ShowToastEvent({
                title: 'Vendor Selected',
                message: `${winner.Vendor__r.Name} has been selected as the active vendor for this line.`,
                variant: 'success'
            });
            this.dispatchEvent(evt);

            const lineId = this.selectedLineDetail ? this.selectedLineDetail.Id : null;
            if (lineId) {
                // Sync manual vendor maps and checkbox sets
                this.selectedVendorsByLine[lineId] = new Set([winner.Id]);
                this.selectedVendorsByLine = { ...this.selectedVendorsByLine };
                this.compareSelectedVendorIds = new Set([winner.Id]);
                this.selectedVendorId = winner.Id;

                // Dynamically update the main line in the grid
                this.allLines = this.allLines.map(line => {
                    if (line.Id === lineId) {
                        const newVendorName = winner.Vendor__r.Name;
                        return {
                            ...line,
                            vendorName: newVendorName,
                            hasPreferredVendor: line.preferredVendorName && newVendorName === line.preferredVendorName
                        };
                    }
                    return line;
                });
                this.applyFilters(true);
            }
        }
        this.activeTab = 'approvedVendors'; // Switch back to Approved Vendors tab
    }

    get comparedVendorsList() {
        return this.comparedVendors.map(vendor => ({
            ...vendor,
            isWinner: vendor.Id === this.selectedWinnerVendorId
        }));
    }

    get recommendedVendor() {
        if (!this.comparedVendors || this.comparedVendors.length === 0) return null;
        let best = this.comparedVendors[0];
        this.comparedVendors.forEach(v => {
            if ((v.Performance_Score__c || 0) > (best.Performance_Score__c || 0)) {
                best = v;
            }
        });
        return best;
    }

    get selectedWinnerName() {
        const winner = this.comparedVendors.find(v => v.Id === this.selectedWinnerVendorId);
        return winner ? winner.Vendor__r.Name : '';
    }

    get hasComparedVendors() {
        return this.comparedVendors.length > 0;
    }

    get selectWinnerButtonLabel() {
        return this.selectedWinnerName ? `Select ${this.selectedWinnerName}` : 'Select Vendor';
    }

    get noWinnerSelected() {
        return !this.selectedWinnerVendorId;
    }

    getPerformanceRating(score) {
        if (score == null) return { rating: '—', class: '' };
        if (score >= 90) return { rating: 'Excellent', class: 'rating-excellent' };
        if (score >= 80) return { rating: 'Good', class: 'rating-good' };
        if (score >= 60) return { rating: 'Average', class: 'rating-average' };
        return { rating: 'Poor', class: 'rating-poor' };
    }

    // ===== COLLAPSIBLE SECTION HANDLERS =====
    toggleContributingSRsSection() {
        this.isContributingSRsExpanded = !this.isContributingSRsExpanded;
    }

    toggleContributingPRLinesSection() {
        this.isContributingPRLinesExpanded = !this.isContributingPRLinesExpanded;
    }

    toggleNotesSection() {
        this.isNotesExpanded = !this.isNotesExpanded;
    }

    toggleDemandPRLineSection() {
        this.isDemandPRLineExpanded = !this.isDemandPRLineExpanded;
    }

    // ===== DEMAND BREAKDOWN HANDLERS =====
    handleDemandSelectAll(event) {
        const isChecked = event.target.checked;
        this.demandSRs = this.demandSRs.map(sr => {
            if (sr.isOrdered) {
                return sr;
            }
            if (isChecked) {
                this.selectedSRsMap[sr.Id] = sr.Purchase_Requisition_Line__c || this.selectedLineDetail.Id;
            } else {
                delete this.selectedSRsMap[sr.Id];
            }
            return {
                ...sr,
                isSelected: isChecked,
                includedQty: isChecked ? sr.Requested_Qty__c : 0,
                rowClass: isChecked ? 'selected-demand-row' : ''
            };
        });
        this.selectedSRsMap = { ...this.selectedSRsMap };
        this.isDemandSelectionApplied = false;
        // syncLineSelectionFromSRs removed
    }

    handleDemandSRSelect(event) {
        const srId = event.target.dataset.id;
        const isChecked = event.target.checked;
        this.demandSRs = this.demandSRs.map(sr => {
            if (sr.Id === srId) {
                if (sr.isOrdered) {
                    return sr;
                }
                if (isChecked) {
                    this.selectedSRsMap[sr.Id] = sr.Purchase_Requisition_Line__c || this.selectedLineDetail.Id;
                } else {
                    delete this.selectedSRsMap[sr.Id];
                }
                return {
                    ...sr,
                    isSelected: isChecked,
                    includedQty: isChecked ? sr.Requested_Qty__c : 0,
                    rowClass: isChecked ? 'selected-demand-row' : ''
                };
            }
            return sr;
        });
        this.selectedSRsMap = { ...this.selectedSRsMap };
        this.isDemandSelectionApplied = false;
        // syncLineSelectionFromSRs removed
    }

    handleIncludedQtyChange(event) {
        const srId = event.target.dataset.id;
        const newQty = parseInt(event.detail.value, 10) || 0;
        this.demandSRs = this.demandSRs.map(sr => {
            if (sr.Id === srId) {
                if (sr.isOrdered) {
                    return sr;
                }
                return { ...sr, includedQty: newQty };
            }
            return sr;
        });
        this.isDemandSelectionApplied = false;
    }

    handleDemandCancel() {
        this.demandSRs.forEach(sr => {
            if (!sr.isOrdered) {
                delete this.selectedSRsMap[sr.Id];
            }
        });
        this.selectedSRsMap = { ...this.selectedSRsMap };
        this.demandSRs = this.demandSRs.map(sr => {
            if (sr.isOrdered) {
                return sr;
            }
            return {
                ...sr,
                isSelected: false,
                includedQty: 0,
                rowClass: ''
            };
        });
        this.isDemandSelectionApplied = true;
        // syncLineSelectionFromSRs removed
    }

    handleDemandApply() {
        const selectedSRCount = this.demandSRs.filter(sr => sr.isSelected).length;
        this.dispatchEvent(
            new ShowToastEvent({
                title: 'Selection Applied',
                message: `Successfully selected ${selectedSRCount} Supply Request(s) for PO generation.`,
                variant: 'success'
            })
        );
        this.isDemandSelectionApplied = true;
    }

    // ===== APPROVED VENDOR HANDLERS =====
    handleVendorClick(event) {
        const vendorId = event.currentTarget.dataset.id;
        this.approvedVendors = this.approvedVendors.map(vendor => {
            if (vendor.Id === vendorId) {
                const isExpanded = !vendor.isExpanded;
                return {
                    ...vendor,
                    isExpanded: isExpanded,
                    chevronIcon: isExpanded ? 'utility:chevronup' : 'utility:chevrondown'
                };
            }
            return {
                ...vendor,
                isExpanded: false,
                chevronIcon: 'utility:chevrondown'
            };
        });
    }

    handleRecordNavigate(event) {
        event.preventDefault();
        const recordId = event.currentTarget.dataset.id;
        const objectApiName = event.currentTarget.dataset.object;
        if (recordId && objectApiName) {
            this[NavigationMixin.GenerateUrl]({
                type: 'standard__recordPage',
                attributes: {
                    recordId: recordId,
                    objectApiName: objectApiName,
                    actionName: 'view'
                }
            }).then(url => {
                window.open(url, '_blank');
            }).catch(error => {
                console.error('Error generating navigation URL:', error);
                this[NavigationMixin.Navigate]({
                    type: 'standard__recordPage',
                    attributes: {
                        recordId: recordId,
                        objectApiName: objectApiName,
                        actionName: 'view'
                    }
                });
            });
        }
    }

    // ===== UTILITY =====
    formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            const options = { day: '2-digit', month: 'short', year: 'numeric' };
            return date.toLocaleDateString('en-GB', options).replace(/ /g, '-');
        } catch (e) {
            return dateStr;
        }
    }
}