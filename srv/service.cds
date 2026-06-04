using cost.distribution from '../db/schema';
type DistributionResponse {
    processId : UUID;
    status    : String;
}
service CostDistributionService {

    entity ProcessLog as projection on distribution.ProcessLog;
    entity EventSuppliers      as projection on distribution.EventSuppliers;
    

    action triggerDistribution(
        eventId     : String,
        supplierId  : String,
        triggeredBy : String
    ) returns DistributionResponse;



}