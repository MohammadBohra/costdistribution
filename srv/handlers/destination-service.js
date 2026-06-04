const {
    executeHttpRequest
} = require('@sap-cloud-sdk/http-client');

async function postToAriba(
    destinationName,
    url,
    data,
    headers = {}
) {

    return executeHttpRequest(
        {
            destinationName
        },
        {
            method: 'POST',
            url,
            data,
            headers
        }
    );
}

async function getFromAriba(
    url,
    headers = {}
) {

    return executeHttpRequest(
        {
            destinationName:
                'Aramco-e-Marketplace-surrogate-bidding'
        },
        {
            method: 'GET',
            url,
            headers,
            responseType: 'arraybuffer'
        }
    );
}

module.exports = {
    postToAriba,
    getFromAriba
};