const cds = require('@sap/cds');
const axios = require('axios');
const {
    getDestination
} = require('@sap-cloud-sdk/connectivity');

async function getAribaConfig() {

    const destinationName =
        cds.env.requires?.ARIBA?.credentials?.destination;

    if (!destinationName) {
        throw new Error(
            'Destination name missing in cds.requires.ARIBA'
        );
    }

    const destination =
        await getDestination({ destinationName });

    if (!destination) {
        throw new Error(
            `Destination ${destinationName} not found`
        );
    }

    const config =
        destination.originalProperties
            .destinationConfiguration;

    return {

        destinationName,        

        apiKey: 'ApF87pHriBIDY9Mu3dK4TzW9gQLIewEB',
        // apiKey : config.apikey,

        realm: config.realm,

        user: config.user,

        passwordAdapter: config.passwordAdapter,
        baseUrl: config.URL,
        clienId: config.clientId,
        clientSecret: config.clientSecret,
        tokenUrl: config.tokenServiceURL,
        supplierId: 'user10060046@test.com',
    };
}

let cachedToken = null;
let tokenExpiry = null;

async function getAccessTokenCached(tokenUrl, clientId, clientSecret) {

    // Reuse existing token
    if (
        cachedToken &&
        tokenExpiry &&
        Date.now() < tokenExpiry
    ) {
        return cachedToken;
    }

    // Fetch new token
    const tokenResponse = await getAccessToken(tokenUrl, clientId, clientSecret);

    cachedToken = tokenResponse.data.access_token;

    // Expire 1 minute early for safety
    tokenExpiry =
        Date.now() +
        ((tokenResponse.data.expires_in - 60) * 1000);

    return cachedToken;
}

async function getAccessToken(tokenUrl, clientId, clientSecret) {

  const tokenResponse = await axios.post(
    tokenUrl,
    'grant_type=client_credentials',
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      auth: {
        username: clientId,
        password: clientSecret
      }
    }
  )

  return tokenResponse;

}

module.exports = {
    getAribaConfig,
    getAccessTokenCached
};