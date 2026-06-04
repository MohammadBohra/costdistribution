const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {

    const {
        startProcess
    } = require('./handlers/ariba-service');

    this.on('triggerDistribution', async (req) => {

        const {
            eventId,
            supplierId
        } = req.data;
        triggeredBy = req.user.id;
        return await startProcess(
            this,
            eventId,
            supplierId,
            triggeredBy
        );

    });

});