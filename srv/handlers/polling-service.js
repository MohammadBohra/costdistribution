const axios = require('axios');
const {
    getAribaConfig, getAccessTokenCached
} = require('./destination-config');

const {
    TIME, STATUS
} = require('../utils/constants');

require('dotenv').config();



async function pollJobStatus(jobId, operation,processId, eventId, supplierId, db) {

    const {
        apiKey,
        realm,
        user,
        passwordAdapter,clienId, clientSecret, baseUrl
    } = await getAribaConfig();

    const accessToken = await getAccessTokenCached(baseUrl, clienId, clientSecret);

    const timeout =
        Number(TIME.POLL_TIMEOUT);

    const interval =
        Number(TIME.POLL_INTERVAL);

    const start = Date.now();

    const url =
        `https://mn2.openapi.ariba.com/api/sourcing-event-bid/v1/prod/jobs/${jobId}` +
        `?realm=${encodeURIComponent(realm)}` +
        `&user=${encodeURIComponent(user)}` +
        `&passwordAdapter=${encodeURIComponent(passwordAdapter)}`;

    while (true) {

        try {
            console.log(
    `[${new Date().toISOString()}] Polling ${operation} Job ${jobId}`
);
            const response = await axios.get(
                url,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        apiKey: apiKey,
                        Accept: 'application/json'
                    },
                    timeout: 60000
                }
            );

            const data = response.data;

            console.log(
    `[${new Date().toISOString()}] Status = ${data.jobStatus}`
);

            console.log('JOB_STATUS_UPDATE Log:', {
    processId,
    eventId,
    supplierId,
    status: STATUS.JOB_STATUS_UPDATE,
    message: `${operation} job status: ${data.jobStatus}`,
    dbExists: !!db
});

            await insertLog(
                processId,
                eventId,
                supplierId,
                STATUS.JOB_STATUS_UPDATE,
                `${operation} job status: ${data.jobStatus}`,
                db
            );

            // SUCCESS
            if (data.jobStatus === 'Success') {
                return data;
            }

            // FAILURE
            if (
                data.jobStatus === 'Failure' ||
                data.jobStatus === 'Failed' ||
                data.jobStatus === 'Error'
            ) {

                let errorMessage =
                    `${operation} failed`;

                // Append Ariba messages
                if (
                    data.messages &&
                    Array.isArray(data.messages) &&
                    data.messages.length > 0
                ) {

                    errorMessage +=
                        `\n\n` +
                        data.messages.join('\n');
                }

                const error = new Error(errorMessage);

                // optional: attach full response
                error.details = data;

                throw error;
            }

            // TIMEOUT
            if (
                Date.now() - start > timeout
            ) {

                throw new Error(
                    `${operation} timeout`
                );
            }
console.log(`Sleeping ${interval} ms`);
            await sleep(interval);

        } catch (error) {

            console.error(
                `${operation} Polling Error:`,
                error.response?.data || error.message
            );

            await insertLog(
                processId,
                eventId,
                supplierId,
                STATUS.POLLING_ERROR,
                `${operation} polling failed - ${error.response?.data || error.message}`,
                db
            );

            throw error;
        }
    }
}



function sleep(ms) {
    return new Promise(
        resolve => setTimeout(resolve, ms)
    );
}

async function insertLog(
    processId,
    eventId,
    supplierId,
    status,
    errorMessage,
    db
) {
    await db.run(
        INSERT.into('cost.distribution.ProcessLog').entries({
            ID: cds.utils.uuid(),
            processId,
            eventId,
            supplierId,
            status,
            errorMessage,
            createdAt: new Date()
        })
    );
}

module.exports = {
    pollJobStatus
};