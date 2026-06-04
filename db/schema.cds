namespace cost.distribution;

using { managed } from '@sap/cds/common';

entity ProcessLog : managed {

    key ID                 : UUID;
    processId             : UUID;
    eventId                : String(100);
    supplierId             : String(255);

    triggeredBy            : String(255);

    status                 : String(50);
    currentStep            : String(100);

    distributionMethod     : String(100);

    oldValues              : LargeString;
    newValues              : LargeString;

    exportJobId            : String(100);
    exportFileId           : String(100);

    importJobId            : String(100);

    submitJobId            : String(100);

    errorMessage           : LargeString;

    startedAt              : Timestamp;
    completedAt            : Timestamp;

}

@cds.persistence.name : 'EVENTSUPPLIERS_REMOTE'
entity EventSuppliers {  
  EventId     : String(20);
  ANID : String(50);
  key SupplierContactEmail : String(100);
  SupplierContactName:String(200);
  SmVendorID     : String(50);
  SupplierName : String(500);
}