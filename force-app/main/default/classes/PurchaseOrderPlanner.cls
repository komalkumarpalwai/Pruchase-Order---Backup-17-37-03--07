public with sharing class PurchaseOrderPlanner {

    /**
     * Get all Purchase Requisition Lines with related Item, Inventory, and PR details.
     * Used for the main data table.
     */
    @AuraEnabled
    public static List<Purchase_Requisition_Line__c> getPurchaseRequisitionLines() {
        return [
            SELECT Id, Name, Requested_Qty__c, Status__c,
                   Item__c, Item__r.Name, Item__r.Item_Code__c, Item__r.Item_Description__c,
                   Item__r.Item_Family__c, Item__r.Unit_Of_Measure__c,
                   Item__r.Quantity_Unit_Of_Measure__c, Item__r.Active__c,
                   Item__r.Reorder_Level__c, Item__r.Target_Stock_Level__c,
                   Item__r.Delivery_Preparation_Time__c, Item__r.Default_Supply_Method__c,
                   Inventory_Location__c, Inventory_Location__r.Name,
                   Purchase_Requisition__c, Purchase_Requisition__r.Name,
                   Purchase_Requisition__r.PR_No__c, Purchase_Requisition__r.Status__c,
                   Purchase_Requisition__r.Requested_Date__c,
                   Purchase_Requisition__r.Inventory_Location__c,
                   Purchase_Requisition__r.Inventory_Location__r.Name
            FROM Purchase_Requisition_Line__c
            WHERE Status__c IN ('Open', 'Partially Ordered')
            ORDER BY Name ASC
        ];
    }

    /**
     * Get full details for a single PRLI including Item and Inventory.
     * Used for the Overview tab in the right panel.
     */
    @AuraEnabled(cacheable=true)
    public static Purchase_Requisition_Line__c getLineDetails(Id prLineId) {
        List<Purchase_Requisition_Line__c> lines = [
            SELECT Id, Name, Requested_Qty__c, Status__c,
                   Item__c, Item__r.Name, Item__r.Item_Code__c, Item__r.Item_Description__c,
                   Item__r.Item_Family__c, Item__r.Unit_Of_Measure__c,
                   Item__r.Quantity_Unit_Of_Measure__c, Item__r.Active__c,
                   Item__r.Reorder_Level__c, Item__r.Target_Stock_Level__c,
                   Item__r.Delivery_Preparation_Time__c, Item__r.Default_Supply_Method__c,
                   Inventory_Location__c, Inventory_Location__r.Name,
                   Purchase_Requisition__c, Purchase_Requisition__r.Name,
                   Purchase_Requisition__r.PR_No__c, Purchase_Requisition__r.Status__c,
                   Purchase_Requisition__r.Requested_Date__c,
                   Purchase_Requisition__r.Requested_By__c,
                   Purchase_Requisition__r.Inventory_Location__c,
                   Purchase_Requisition__r.Inventory_Location__r.Name
            FROM Purchase_Requisition_Line__c
            WHERE Id = :prLineId
            LIMIT 1
        ];
        return lines.isEmpty() ? null : lines[0];
    }

    /**
     * Get all Inventory records for a given Item across all locations.
     * Used for the Inventory tab.
     */
    @AuraEnabled(cacheable=true)
    public static List<Inventory__c> getInventoryByItem(Id itemId) {
        return [
            SELECT Id, Name, Inventory_Location__c, Inventory_Location__r.Name, Available__c, On_Hand_Qty__c,
                   Reserved__c, Damaged__c, Reorder_Level__c, Target_Stock_Level__c,
                   Transit_In_Quantity__c, Transit_Out_Quantity__c,
                   Item__c, Item__r.Name
            FROM Inventory__c
            WHERE Item__c = :itemId
            ORDER BY Name ASC
        ];
    }

    /**
     * Get contributing Supply Requests for a given Item.
     * These are Supply_Request__c records linked to the same Item.
     * Used for the Contributing SRs tab.
     */
    @AuraEnabled(cacheable=true)
    public static List<Supply_Request__c> getContributingSRs(Id prLineId) {
        return [
            SELECT Id, Name, Request_Type__c, Requested_Qty__c, Received_Qty__c,
                   Required_Date__c, Status__c, Supply_Method__c, Type__c,
                   Item__c, Item__r.Name,
                   Inventory_Location__c,
                   Order_Allocation_Line_Item__c,
                   Purchase_Requisition_Line__c
            FROM Supply_Request__c
            WHERE Purchase_Requisition_Line__c = :prLineId
            ORDER BY Name ASC
        ];
    }

    /**
     * Get Contributing PR Lines for a given Purchase Requisition.
     * Returns all sibling PR Lines under the same parent PR.
     * Used for the Contributing PR Lines collapsible section.
     */
    @AuraEnabled(cacheable=true)
    public static List<Purchase_Requisition_Line__c> getContributingPRLines(Id purchaseRequisitionId, Id itemId) {
        return [
            SELECT Id, Name, Requested_Qty__c, Status__c,
                   Item__c, Item__r.Name, Item__r.Item_Code__c,
                   Inventory_Location__c, Inventory_Location__r.Name,
                   Purchase_Requisition__c, Purchase_Requisition__r.Name,
                   Purchase_Requisition__r.PR_No__c
            FROM Purchase_Requisition_Line__c
            WHERE Purchase_Requisition__c = :purchaseRequisitionId
              AND Item__c = :itemId
            ORDER BY Name ASC
        ];
    }

    /**
     * Get all Supply Requests for a given Item for Demand Breakdown.
     * Shows all demand/supply requests across the system for this item.
     * Used for the Demand Breakdown tab.
     */
    @AuraEnabled(cacheable=true)
    public static List<Supply_Request__c> getDemandBreakdown(Id prLineId) {
        return [
            SELECT Id, Name, Request_Type__c, Requested_Qty__c, Received_Qty__c,
                   Required_Date__c, Status__c, Supply_Method__c, Type__c,
                   Item__c, Item__r.Name,
                   Inventory_Location__c,
                   Purchase_Requisition_Line__c
            FROM Supply_Request__c
            WHERE Purchase_Requisition_Line__c = :prLineId
            ORDER BY Name ASC
        ];
    }

    /**
     * Get all Approved Vendors for a given Item.
     * Returns Product_Vendors__c records where Is_Approved__c is true.
     * Used for the Approved Vendors tab.
     */
    @AuraEnabled(cacheable=true)
    public static List<Product_Vendors__c> getApprovedVendors(Id itemId, Id locationId) {
        if (locationId == null) {
            return [
                SELECT Id, Name, Vendor__c, Vendor__r.Name,
                       Is_Approved__c, Is_Preferred__c, Active__c,
                       Last_Purchase_Price__c, Lead_Time_Days__c,
                       Performance_Score__c, Performance_Rating__c, Rank__c, Last_Reviewed_Date__c,
                       Item__c, Item__r.Name, Inventory_Location__c
                FROM Product_Vendors__c
                WHERE Item__c = :itemId
                  AND Active__c = true
                  AND (Is_Approved__c = true OR Is_Preferred__c = true)
                ORDER BY Is_Preferred__c DESC, Rank__c ASC
            ];
        } else {
            return [
                SELECT Id, Name, Vendor__c, Vendor__r.Name,
                       Is_Approved__c, Is_Preferred__c, Active__c,
                       Last_Purchase_Price__c, Lead_Time_Days__c,
                       Performance_Score__c, Performance_Rating__c, Rank__c, Last_Reviewed_Date__c,
                       Item__c, Item__r.Name, Inventory_Location__c
                FROM Product_Vendors__c
                WHERE Item__c = :itemId
                  AND (Inventory_Location__c = :locationId OR Inventory_Location__c = null)
                  AND Active__c = true
                  AND (Is_Approved__c = true OR Is_Preferred__c = true)
                ORDER BY Is_Preferred__c DESC, Rank__c ASC
            ];
        }
    }

    /**
     * Get the preferred vendor for an Item.
     * Returns the Product_Vendors__c record where Is_Preferred__c is true.
     */
    @AuraEnabled(cacheable=true)
    public static List<Product_Vendors__c> getPreferredVendor(Id itemId) {
        return [
            SELECT Id, Name, Vendor__c, Vendor__r.Name,
                   Is_Preferred__c, Lead_Time_Days__c, Last_Purchase_Price__c,
                   Inventory_Location__c
            FROM Product_Vendors__c
            WHERE Item__c = :itemId AND Is_Preferred__c = true
        ];
    }

    /**
     * Get all active approved/preferred product vendors for a list of items.
     * Used to dynamically auto-select vendors when a line has exactly one approved vendor.
     */
    @AuraEnabled(cacheable=true)
    public static List<Product_Vendors__c> getAllProductVendors(List<Id> itemIds) {
        return [
            SELECT Id, Name, Vendor__c, Vendor__r.Name,
                   Is_Approved__c, Is_Preferred__c, Active__c,
                   Last_Purchase_Price__c, Lead_Time_Days__c,
                   Performance_Score__c, Performance_Rating__c, Rank__c, Last_Reviewed_Date__c,
                   Item__c, Item__r.Name, Inventory_Location__c
            FROM Product_Vendors__c
            WHERE Item__c IN :itemIds
              AND Active__c = true
              AND (Is_Approved__c = true OR Is_Preferred__c = true)
            ORDER BY Is_Preferred__c DESC, Rank__c ASC
        ];
    }


    /**
     * Generate Purchase Orders from selected Supply Requests.
     * Groups selected SRs by Vendor and Warehouse Location.
     * Validates that an approved vendor is set up for each item.
     */
    public static Map<String, Object> generatePurchaseOrders(List<Id> supplyRequestIds) {
        return generatePurchaseOrders(supplyRequestIds, null);
    }

    @AuraEnabled
    public static Map<String, Object> generatePurchaseOrders(List<Id> supplyRequestIds, Map<Id, Id> manualVendorMap) {
        Map<String, Object> response = new Map<String, Object>();
        if (supplyRequestIds == null || supplyRequestIds.isEmpty()) {
            response.put('success', false);
            response.put('message', 'No supply requests were selected.');
            return response;
        }

        Savepoint sp = Database.setSavepoint();
        try {
            // 1. Query Supply Requests (locking records to prevent concurrent races)
            List<Supply_Request__c> srs = [
                SELECT Id, Name, Item__c, Item__r.Name, Item__r.Active__c, Inventory_Location__c, Requested_Qty__c, Status__c, Purchase_Requisition_Line__c, Required_Date__c
                FROM Supply_Request__c
                WHERE Id IN :supplyRequestIds
                FOR UPDATE
            ];

            if (srs.isEmpty()) {
                response.put('success', false);
                response.put('message', 'No matching supply requests found in the system.');
                return response;
            }

            // Validate backend business rules (TC-10, TC-11, Warehouse, and Active checks)
            for (Supply_Request__c sr : srs) {
                if (sr.Requested_Qty__c == null || sr.Requested_Qty__c <= 0) {
                    response.put('success', false);
                    response.put('message', 'Quantity must be greater than zero for Supply Request: ' + sr.Name);
                    return response;
                }
                if (sr.Inventory_Location__c == null) {
                    response.put('success', false);
                    response.put('message', 'Warehouse Location is missing for Supply Request: ' + sr.Name);
                    return response;
                }
                if (sr.Item__r != null && !sr.Item__r.Active__c) {
                    response.put('success', false);
                    response.put('message', 'Cannot generate Purchase Order for inactive item: ' + sr.Item__r.Name);
                    return response;
                }
            }

            // Check for concurrency: verify if any selected supply request is already ordered
            List<Purchase_Order_Allocation__c> existingAllocations = [
                SELECT Supply_Request__r.Name 
                FROM Purchase_Order_Allocation__c 
                WHERE Supply_Request__c IN :supplyRequestIds
            ];
            
            if (!existingAllocations.isEmpty()) {
                Set<String> alreadyOrderedSRNames = new Set<String>();
                for (Purchase_Order_Allocation__c poa : existingAllocations) {
                    if (poa.Supply_Request__r != null) {
                        alreadyOrderedSRNames.add(poa.Supply_Request__r.Name);
                    }
                }
                
                response.put('success', false);
                response.put('isDuplicate', true);
                response.put('message', 'One or more supply requests have already been processed and ordered: ' + String.join(new List<String>(alreadyOrderedSRNames), ', ') + '. Please refresh the page.');
                return response;
            }

            // Gather item IDs to search for vendor mappings
            Set<Id> itemIds = new Set<Id>();
            for (Supply_Request__c sr : srs) {
                if (sr.Item__c != null) {
                    itemIds.add(sr.Item__c);
                }
            }

            Set<Id> manualPvIds = new Set<Id>();
            if (manualVendorMap != null) {
                for (Id pvId : manualVendorMap.values()) {
                    if (pvId != null) {
                        manualPvIds.add(pvId);
                    }
                }
            }

            // 2. Query all active Product_Vendors__c for these items to resolve matches
            List<Product_Vendors__c> pvs = [
                SELECT Id, Item__c, Vendor__c, Vendor__r.Name, Is_Preferred__c, Inventory_Location__c, Last_Purchase_Price__c, Lead_Time_Days__c
                FROM Product_Vendors__c
                WHERE (Item__c IN :itemIds OR Id IN :manualPvIds) AND Active__c = true
            ];

            // Map of ItemId -> List of vendor records
            Map<Id, List<Product_Vendors__c>> itemToVendorsMap = new Map<Id, List<Product_Vendors__c>>();
            Map<Id, Product_Vendors__c> pvIdToRecordMap = new Map<Id, Product_Vendors__c>();
            for (Product_Vendors__c pv : pvs) {
                pvIdToRecordMap.put(pv.Id, pv);
                if (!itemToVendorsMap.containsKey(pv.Item__c)) {
                    itemToVendorsMap.put(pv.Item__c, new List<Product_Vendors__c>());
                }
                itemToVendorsMap.get(pv.Item__c).add(pv);
            }

            // Map of SR ID -> resolved Product_Vendors__c
            Map<Id, Product_Vendors__c> srToVendorMap = new Map<Id, Product_Vendors__c>();

            // Grouping structures
            // unique key: vendorId + '_' + locationId
            Map<String, List<Supply_Request__c>> poGroupMap = new Map<String, List<Supply_Request__c>>();
            Map<String, Id> vendorKeyMap = new Map<String, Id>();
            Map<String, Id> locationKeyMap = new Map<String, Id>();

            for (Supply_Request__c sr : srs) {
                Product_Vendors__c bestVendor = null;

                // Priority 1: Check manual vendor mapping
                // Priority 1: Check manual vendor mapping
                Boolean hasManualSelection = (manualVendorMap != null && sr.Purchase_Requisition_Line__c != null && manualVendorMap.containsKey(sr.Purchase_Requisition_Line__c));
                if (hasManualSelection) {
                    Id manualPvId = manualVendorMap.get(sr.Purchase_Requisition_Line__c);
                    if (manualPvId != null && pvIdToRecordMap.containsKey(manualPvId)) {
                        bestVendor = pvIdToRecordMap.get(manualPvId);
                    }
                    if (bestVendor == null) {
                        response.put('success', false);
                        response.put('message', 'The manually selected vendor is inactive or no longer approved for item: ' + sr.Item__r.Name + '. Please select another vendor.');
                        return response;
                    }
                }

                // Fall back to auto-priority resolution logic
                if (bestVendor == null) {
                    List<Product_Vendors__c> pvList = itemToVendorsMap.get(sr.Item__c);
                    if (pvList != null && !pvList.isEmpty()) {
                        // Match Priority 1: Specific Location Preferred
                        for (Product_Vendors__c pv : pvList) {
                            if (pv.Is_Preferred__c && pv.Inventory_Location__c == sr.Inventory_Location__c) {
                                bestVendor = pv;
                                break;
                            }
                        }
                        // Match Priority 2: Global Preferred
                        if (bestVendor == null) {
                            for (Product_Vendors__c pv : pvList) {
                                if (pv.Is_Preferred__c && pv.Inventory_Location__c == null) {
                                    bestVendor = pv;
                                    break;
                                }
                            }
                        }
                        // Match Priority 3: Specific Location Approved
                        if (bestVendor == null) {
                            for (Product_Vendors__c pv : pvList) {
                                if (pv.Inventory_Location__c == sr.Inventory_Location__c) {
                                    bestVendor = pv;
                                    break;
                                }
                            }
                        }
                        // Match Priority 4: Global Approved
                        if (bestVendor == null) {
                            for (Product_Vendors__c pv : pvList) {
                                if (pv.Inventory_Location__c == null) {
                                    bestVendor = pv;
                                    break;
                                }
                            }
                        }
                        // Fallback to first available active vendor
                        if (bestVendor == null) {
                            bestVendor = pvList[0];
                        }
                    }
                }

                if (bestVendor == null || bestVendor.Vendor__c == null) {
                    response.put('success', false);
                    response.put('message', 'No active or approved vendor found for item: ' + sr.Item__r.Name + '. Please set up an approved vendor first.');
                    return response;
                }

                srToVendorMap.put(sr.Id, bestVendor);
                String key = bestVendor.Vendor__c + '_' + sr.Inventory_Location__c;
                if (!poGroupMap.containsKey(key)) {
                    poGroupMap.put(key, new List<Supply_Request__c>());
                    vendorKeyMap.put(key, bestVendor.Vendor__c);
                    locationKeyMap.put(key, sr.Inventory_Location__c);
                }
                poGroupMap.get(key).add(sr);
            }

            // 3. Create and Insert Purchase Order records
            Map<String, Purchase_Order__c> poMap = new Map<String, Purchase_Order__c>();
            List<Purchase_Order__c> posToInsert = new List<Purchase_Order__c>();

            for (String key : poGroupMap.keySet()) {
                Purchase_Order__c po = new Purchase_Order__c();
                po.Vendor__c = vendorKeyMap.get(key);
                po.Ship_to_Warehouse__c = locationKeyMap.get(key);
                po.Status__c = 'Draft';
                po.PO_Date__c = Date.today();
                
                // Calculate the earliest Required_Date__c among all grouped Supply Requests for this PO
                Date earliestRequiredDate = null;
                if (poGroupMap.containsKey(key)) {
                    for (Supply_Request__c sr : poGroupMap.get(key)) {
                        if (sr.Required_Date__c != null) {
                            if (earliestRequiredDate == null || sr.Required_Date__c < earliestRequiredDate) {
                                earliestRequiredDate = sr.Required_Date__c;
                            }
                        }
                    }
                }
                po.Expected_Date__c = earliestRequiredDate;
                
                poMap.put(key, po);
                posToInsert.add(po);
            }
            insert posToInsert;

            // 4. Create and Insert Purchase Order Line Item records
            // Within each PO group, group by Item__c
            List<SObject> polisToInsert = new List<SObject>();
            // Key: poKey + '_' + itemId -> Inserted SObject record
            Map<String, SObject> insertedPoliMap = new Map<String, SObject>();

            // Find unit prices and sum quantities
            for (String poKey : poGroupMap.keySet()) {
                List<Supply_Request__c> groupSRs = poGroupMap.get(poKey);
                Purchase_Order__c parentPo = poMap.get(poKey);

                // Group by ItemId
                Map<Id, List<Supply_Request__c>> itemSRsMap = new Map<Id, List<Supply_Request__c>>();
                for (Supply_Request__c sr : groupSRs) {
                    if (!itemSRsMap.containsKey(sr.Item__c)) {
                        itemSRsMap.put(sr.Item__c, new List<Supply_Request__c>());
                    }
                    itemSRsMap.get(sr.Item__c).add(sr);
                }

                for (Id itemId : itemSRsMap.keySet()) {
                    List<Supply_Request__c> itemSRs = itemSRsMap.get(itemId);
                    Decimal totalQty = 0;
                    for (Supply_Request__c sr : itemSRs) {
                        totalQty += (sr.Requested_Qty__c != null ? sr.Requested_Qty__c : 0);
                    }

                    // Find price from first resolved vendor mapping for the item
                    Product_Vendors__c firstVendorRecord = srToVendorMap.get(itemSRs[0].Id);
                    Decimal price = firstVendorRecord.Last_Purchase_Price__c != null ? firstVendorRecord.Last_Purchase_Price__c : 0.00;

                    SObject poli = new Purchase_Order_Line_Item__c();
                    poli.put('Purchase_Order__c', parentPo.Id);
                    poli.put('Item__c', itemId);
                    poli.put('Ordered_Qty__c', totalQty);
                    poli.put('Unit_Price__c', price);
                    poli.put('Status__c', 'Open');

                    // Check for optional fields dynamically
                    Map<String, SObjectField> fieldMap = Purchase_Order_Line_Item__c.SObjectType.getDescribe().fields.getMap();
                    if (fieldMap.containsKey('Received_Qty__c') && fieldMap.get('Received_Qty__c').getDescribe().isCreateable()) {
                        poli.put('Received_Qty__c', 0.00);
                    }
                    if (fieldMap.containsKey('Remaining_Qty__c') && fieldMap.get('Remaining_Qty__c').getDescribe().isCreateable()) {
                        poli.put('Remaining_Qty__c', totalQty);
                    }

                    polisToInsert.add(poli);
                    String poliKey = poKey + '_' + itemId;
                    insertedPoliMap.put(poliKey, poli);
                }
            }
            insert polisToInsert;

            // 5. Create and Insert Purchase Order Allocation records
            List<SObject> poasToInsert = new List<SObject>();
            for (Supply_Request__c sr : srs) {
                Product_Vendors__c resolvedVendor = srToVendorMap.get(sr.Id);
                String poKey = resolvedVendor.Vendor__c + '_' + sr.Inventory_Location__c;
                String poliKey = poKey + '_' + sr.Item__c;
                SObject poli = insertedPoliMap.get(poliKey);

                SObject poa = new Purchase_Order_Allocation__c();
                poa.put('Purchase_Order_Line_Item__c', poli.Id);
                poa.put('Supply_Request__c', sr.Id);
                poa.put('Allocated_Qty__c', sr.Requested_Qty__c != null ? sr.Requested_Qty__c : 0);

                Map<String, SObjectField> poaFieldMap = Purchase_Order_Allocation__c.SObjectType.getDescribe().fields.getMap();
                if (poaFieldMap.containsKey('Received_Qty__c') && poaFieldMap.get('Received_Qty__c').getDescribe().isCreateable()) {
                    poa.put('Received_Qty__c', 0.00);
                }

                poasToInsert.add(poa);
            }
            insert poasToInsert;

            // 6. Update status on all selected Supply Requests
            List<Supply_Request__c> srsToUpdate = new List<Supply_Request__c>();
            for (Supply_Request__c sr : srs) {
                sr.Status__c = 'Ordered';
                srsToUpdate.add(sr);
            }
            update srsToUpdate;

            // 7. Update status on corresponding Purchase Requisition Lines based on their Supply Request statuses
            Set<Id> prlIdsToUpdate = new Set<Id>();
            for (Supply_Request__c sr : srs) {
                if (sr.Purchase_Requisition_Line__c != null) {
                    prlIdsToUpdate.add(sr.Purchase_Requisition_Line__c);
                }
            }
            if (!prlIdsToUpdate.isEmpty()) {
                // Query ALL Supply Requests under each affected PRLI to check their statuses
                List<Supply_Request__c> allSiblingSRs = [
                    SELECT Id, Status__c, Purchase_Requisition_Line__c
                    FROM Supply_Request__c
                    WHERE Purchase_Requisition_Line__c IN :prlIdsToUpdate
                ];

                // For each PRLI, check if ALL its SRs are 'Ordered'
                // If all are Ordered → 'Fully Ordered', if some are Ordered → 'Partially Ordered'
                Map<Id, Boolean> prliAllOrdered = new Map<Id, Boolean>();
                Map<Id, Boolean> prliHasOrdered = new Map<Id, Boolean>();
                for (Id prlId : prlIdsToUpdate) {
                    prliAllOrdered.put(prlId, true);
                    prliHasOrdered.put(prlId, false);
                }
                for (Supply_Request__c siblingSR : allSiblingSRs) {
                    Id prlId = siblingSR.Purchase_Requisition_Line__c;
                    if (siblingSR.Status__c == 'Ordered') {
                        prliHasOrdered.put(prlId, true);
                    } else {
                        prliAllOrdered.put(prlId, false);
                    }
                }

                List<Purchase_Requisition_Line__c> prlsToUpdate = new List<Purchase_Requisition_Line__c>();
                for (Id prlId : prlIdsToUpdate) {
                    String newStatus;
                    if (prliAllOrdered.get(prlId) == true) {
                        newStatus = 'Fully Ordered';
                    } else if (prliHasOrdered.get(prlId) == true) {
                        newStatus = 'Partially Ordered';
                    } else {
                        continue; // No SRs are ordered, skip
                    }
                    prlsToUpdate.add(new Purchase_Requisition_Line__c(
                        Id = prlId,
                        Status__c = newStatus
                    ));
                }
                if (!prlsToUpdate.isEmpty()) {
                    update prlsToUpdate;
                }
            }

            // 8. Update parent Purchase Requisition status to 'Converted' if ALL its PRLIs are 'Fully Ordered'
            // First, collect all parent PR Ids from the updated PRLIs
            Set<Id> parentPRIds = new Set<Id>();
            for (Supply_Request__c sr : srs) {
                if (sr.Purchase_Requisition_Line__c != null) {
                    // We need to get the PR Id from the PRLI — query them
                    parentPRIds.add(sr.Purchase_Requisition_Line__c);
                }
            }
            if (!parentPRIds.isEmpty()) {
                // Query the PRLIs to get their parent PR Ids
                List<Purchase_Requisition_Line__c> updatedPRLIs = [
                    SELECT Id, Purchase_Requisition__c
                    FROM Purchase_Requisition_Line__c
                    WHERE Id IN :parentPRIds
                ];
                Set<Id> prIds = new Set<Id>();
                for (Purchase_Requisition_Line__c prli : updatedPRLIs) {
                    if (prli.Purchase_Requisition__c != null) {
                        prIds.add(prli.Purchase_Requisition__c);
                    }
                }

                if (!prIds.isEmpty()) {
                    // Query ALL PRLIs under each parent PR to check if every one is 'Fully Ordered'
                    List<Purchase_Requisition_Line__c> allSiblingPRLIs = [
                        SELECT Id, Status__c, Purchase_Requisition__c
                        FROM Purchase_Requisition_Line__c
                        WHERE Purchase_Requisition__c IN :prIds
                    ];

                    // Group by PR Id and check if all non-cancelled are 'Fully Ordered' and there's at least one Fully Ordered
                    Map<Id, Boolean> prAllFullyOrdered = new Map<Id, Boolean>();
                    Map<Id, Boolean> prHasFullyOrdered = new Map<Id, Boolean>();
                    for (Id prId : prIds) {
                        prAllFullyOrdered.put(prId, true);
                        prHasFullyOrdered.put(prId, false);
                    }
                    for (Purchase_Requisition_Line__c sibling : allSiblingPRLIs) {
                        Id prId = sibling.Purchase_Requisition__c;
                        if (sibling.Status__c == 'Fully Ordered') {
                            prHasFullyOrdered.put(prId, true);
                        } else if (sibling.Status__c != 'Cancelled') {
                            // Any line that is neither Fully Ordered nor Cancelled blocks conversion
                            prAllFullyOrdered.put(prId, false);
                        }
                    }

                    List<Purchase_Requisition__c> prsToUpdate = new List<Purchase_Requisition__c>();
                    for (Id prId : prAllFullyOrdered.keySet()) {
                        if (prAllFullyOrdered.get(prId) == true && prHasFullyOrdered.get(prId) == true) {
                            prsToUpdate.add(new Purchase_Requisition__c(
                                Id = prId,
                                Status__c = 'Converted'
                            ));
                        }
                    }
                    if (!prsToUpdate.isEmpty()) {
                        update prsToUpdate;
                    }
                }
            }

            List<Id> poIds = new List<Id>();
            for (Purchase_Order__c po : posToInsert) {
                poIds.add(po.Id);
            }

            // Query details for the custom success modal
            List<Purchase_Order__c> createdPOs = [
                SELECT Id, Name, Vendor__r.Name, Ship_to_Warehouse__r.Name
                FROM Purchase_Order__c
                WHERE Id IN :poIds
            ];
            
            List<Purchase_Order_Line_Item__c> createdPOLIs = [
                SELECT Id, Name, Purchase_Order__c, Item__r.Name, Ordered_Qty__c, Unit_Price__c
                FROM Purchase_Order_Line_Item__c
                WHERE Purchase_Order__c IN :poIds
            ];
            
            List<Purchase_Order_Allocation__c> createdPOAs = [
                SELECT Id, Name, Purchase_Order_Line_Item__c, Supply_Request__r.Name, Allocated_Qty__c
                FROM Purchase_Order_Allocation__c
                WHERE Purchase_Order_Line_Item__c IN :createdPOLIs
            ];

            response.put('success', true);
            response.put('poIds', poIds);
            response.put('pos', createdPOs);
            response.put('polis', createdPOLIs);
            response.put('poas', createdPOAs);
            response.put('message', 'Successfully generated ' + posToInsert.size() + ' Purchase Order(s) and linked ' + poasToInsert.size() + ' allocation record(s).');
            return response;

        } catch (Exception e) {
            Database.rollback(sp);
            response.put('success', false);
            response.put('message', 'Failed to generate Purchase Orders: ' + e.getMessage());
            return response;
        }
    }

    /**
     * Helper to generate Purchase Orders directly from selected PR Lines.
     * Finds matching Supply Requests and delegates to generatePurchaseOrders.
     */
    public static Map<String, Object> generatePOsFromPRLines(List<Id> prLineIds) {
        return generatePOsFromPRLines(prLineIds, null);
    }

    @AuraEnabled
    public static Map<String, Object> generatePOsFromPRLines(List<Id> prLineIds, Map<Id, Id> manualVendorMap) {
        if (prLineIds == null || prLineIds.isEmpty()) {
            Map<String, Object> response = new Map<String, Object>();
            response.put('success', false);
            response.put('message', 'No Requisition Lines were selected.');
            return response;
        }

        // Check for concurrency: verify if any selected PR line is already fully ordered
        // We do this by checking if any allocation already exists for its Supply Requests
        List<Purchase_Order_Allocation__c> existingAllocations = [
            SELECT Supply_Request__r.Purchase_Requisition_Line__r.Name 
            FROM Purchase_Order_Allocation__c 
            WHERE Supply_Request__r.Purchase_Requisition_Line__c IN :prLineIds
        ];
        
        if (!existingAllocations.isEmpty()) {
            Set<String> alreadyOrderedLineNames = new Set<String>();
            for (Purchase_Order_Allocation__c poa : existingAllocations) {
                if (poa.Supply_Request__r != null && poa.Supply_Request__r.Purchase_Requisition_Line__r != null) {
                    alreadyOrderedLineNames.add(poa.Supply_Request__r.Purchase_Requisition_Line__r.Name);
                }
            }
            
            Map<String, Object> response = new Map<String, Object>();
            response.put('success', false);
            response.put('isDuplicate', true);
            response.put('message', 'One or more selected requisition lines have already been processed: ' + String.join(new List<String>(alreadyOrderedLineNames), ', ') + '. Please refresh the page.');
            return response;
        }

        List<Supply_Request__c> srs = [
            SELECT Id 
            FROM Supply_Request__c 
            WHERE Purchase_Requisition_Line__c IN :prLineIds
        ];

        List<Id> srIds = new List<Id>();
        for (Supply_Request__c sr : srs) {
            srIds.add(sr.Id);
        }

        if (srIds.isEmpty()) {
            Map<String, Object> response = new Map<String, Object>();
            response.put('success', false);
            response.put('message', 'No Supply Requests found for the selected Requisition Lines.');
            return response;
        }

        return generatePurchaseOrders(srIds, manualVendorMap);
    }
}