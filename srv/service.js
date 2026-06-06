const cds = require('@sap/cds');
const axios = require('axios');

module.exports = cds.service.impl(async function () {

    const {
        startProcess
    } = require('./handlers/ariba-service');

    this.on('triggerDistribution', async (req) => {
            
        const {
            userInfo,
            userName,
            anid
        } = await getUserContext(req);

        const {
            eventId
        } = req.data;
        triggeredBy = req.user.id;
        try {
        return await startProcess(
            this,
            eventId,
            // supplierId,
            userName
        );
         } catch (err) {
    console.error(err);
    req.reject(500, err.message);
  }

    });

    async function getUserContext(req) {
    
        // -----------------------------------------
        // Read XSUAA
        // -----------------------------------------
        const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
        const xsuaa = vcap?.xsuaa?.[0]?.credentials;
    
        let userName = (req.user?.id || '').trim();
        let anid = '';
        let attrs = {};
        let userInfo = null;
    
        // -----------------------------------------
        // CLOUD MODE (XSUAA available)
        // -----------------------------------------
        if (xsuaa && req.user?.authInfo?.getTokenInfo?.()?.getTokenValue?.()) {
    
            const token =
                req.user.authInfo.getTokenInfo().getTokenValue();
    
            const response = await axios.get(
                `${xsuaa.url}/userinfo`,
                {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );
    
            userInfo = response.data;
    
            attrs = userInfo.user_attributes || {};
    
            userName = (userInfo.user_name || req.user.id || '').trim();
    
            anid = (attrs.ANID?.[0] || '').toLowerCase().trim();
        }
    
        // -----------------------------------------
        // LOCAL MODE (no XSUAA / no token)
        // -----------------------------------------
        else {
    
            console.log("⚠️ Running in LOCAL mode - XSUAA not used");
    
            // Try to simulate attributes locally if needed
            attrs = req.user?.attr || {};
    
            anid = (attrs.ANID || '').toLowerCase?.()?.trim?.() || '';
    
            // fallback already set from req.user.id
        }
    
        return {
            userInfo,
            userName,
            anid,
            attributes: attrs
        };
    }


    this.on('deleteProcessLog', async (req) => {

        const { processId } = req.data;

        if (!processId) {
            req.reject(400, "processId is required");
        }

        const deleted = await DELETE
            .from('ProcessLog')
            .where({ ProcessId: processId });

        return {
            success: true,
            processId,
            deletedRows: deleted
        };
    });




});