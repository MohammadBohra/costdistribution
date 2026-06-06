// const axios = require('axios');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const FormData = require('form-data');
const cds = require('@sap/cds');
const { getDestination } = require('@sap-cloud-sdk/connectivity');

const {
    getAribaConfig, getAccessTokenCached
} = require('./destination-config');

const XLSX = require('xlsx');

require('dotenv').config();

const {
    STATUS
} = require('../utils/constants');

const {
    pollJobStatus
} = require('./polling-service');



async function startProcess(service, eventId, triggeredBy) {

  
    const db = await cds.connect.to('db');
const { SELECT } = cds.ql;

const FINAL_STATUSES = [
    STATUS.SUBMIT_COMPLETED,
    STATUS.SUBMIT_FAILED,
    STATUS.FAILED,
    STATUS.EXPORT_FAILED,
    STATUS.IMPORT_FAILED,
    STATUS.FILE_DOWNLOAD_FAILED
    
];

const latestProcess = await db.run(
  SELECT.one
    .from('cost.distribution.ProcessLog')
    .columns('processId')
    .where({ eventId })
    .orderBy('createdAt desc')
);

if (latestProcess) {

  const completed = await db.run(
    SELECT.one
      .from('cost.distribution.ProcessLog')
      .where({
        processId: latestProcess.processId
      })
      .where({
        status: {
          in: FINAL_STATUSES
        }
      })
  );

  if (!completed) {
    // process still active
    return {
      processId: latestProcess.processId,
      status: 'ACTIVE'
    };
  }
}

    const processId = cds.utils.uuid();
    // Create Log
    const log = {
        ID: cds.utils.uuid(),
        processId,
        eventId,
        //supplierId,
        triggeredBy,
        status: STATUS.REQUEST_RECEIVED,
        currentStep: 'START',
        errorMessage: 'Request received and process started',
    };

    // await INSERT.into('cost.distribution.ProcessLog').entries(log);
    await db.run(
    INSERT.into('cost.distribution.ProcessLog').entries(log)
);



    // Fire and forget
    runProcess(
        processId,
        eventId,
        //supplierId,
        triggeredBy
    ).catch(console.error);

    return {
        processId,
        status: 'STARTED'
    };


    async function runProcess(
    processId,
    eventId,
    //supplierId,
    triggeredBy
) {
    let supplierId1 = null;
    

        // get all suppliers of the event id and trigger export,polling, download, update excel, import and submit for each supplier
        let suppliers = await getSuppliersForEvent(eventId,processId);
        if (suppliers.length === 0) {
            suppliers = await fetchSuppliersFromAriba(eventId,processId);
        }
        if (suppliers.length === 0) {
            await insertLog(
                processId,
                eventId,
                null,
                STATUS.FAILED,
                `No suppliers found for event ${eventId}`,
                db
            );
            return;
        }
        for (const supplierId of suppliers) {
            try {
            supplierId1 = supplierId;
        // EXPORT
        const exportResult = await triggerExport(
            eventId,
            supplierId,
            processId,
            db
        );

       
        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.EXPORT_TRIGGERED,
            `Export Job Created: ${exportResult.jobId}`,
            db
        );

        const exportStatus = await pollJobStatus(
            exportResult.jobId,
            'EXPORT',
            processId,
            eventId,
            supplierId,
            db
        );

        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.EXPORT_COMPLETED,
            `Export completed. File ID: ${exportStatus.fileId}`,
            db
        );

        // DOWNLOAD FILE
        const fileBuffer = await downloadFile(
            exportResult.jobId,
            exportStatus.fileId,
            processId,
            db
        );
        // SAVE ORIGINAL EXCEL
        await saveDownloadedFile(
            fileBuffer,
            `${eventId}_${supplierId}_original.xlsx`
        );


        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.FILE_DOWNLOADED,
            `File downloaded successfully`,
            db
        );

        // PROCESS EXCEL
        const updatedFile = await updateExcel(fileBuffer);

        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.EXCEL_UPDATED,
            `Excel updated successfully`,
            db
        );

        // IMPORT
        const importResult = await triggerImport(
            eventId,
            supplierId,
            updatedFile,
            processId,
            db 
        );

    

        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.IMPORT_TRIGGERED,
            //importJobId: importResult.jobId,
            `Import job triggered. Job ID: ${importResult.jobId}`,
            db
        );

        await pollJobStatus(
            importResult.jobId,
            'IMPORT',
            processId,
            eventId,
            supplierId,
            db
        );


        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.IMPORT_COMPLETED,
            `Import completed successfully`,
            db
    );

        // SAVE UPDATED EXCEL
        await saveDownloadedFile(
            updatedFile,
            `${eventId}_${supplierId}_updated.xlsx`
        );

        // SUBMIT
        const submitResult = await triggerSubmit(
            eventId,
            supplierId,
            processId,
            db
        );

     

        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.SUBMIT_TRIGGERED,
            // submitJobId: submitResult.jobId,
            `Submit job triggered. Job ID: ${submitResult.jobId}`,
            db
        );

        await pollJobStatus(
            submitResult.jobId,
            'SUBMIT',
            processId,
            eventId,
            supplierId,
            db
        );
        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.SUBMIT_COMPLETED,           
            'Submit completed successfully. Cost distribution process finished. for supplier ' + supplierId,
            db
        );

        // return `
        // <html>
        //     <body>
        //         <h3>Completed</h3>
        //         <p>Cost distribution completed successfully for supplier ${supplierId}.</p>
        //     </body>
        // </html>
        // `;
    }
        catch (err) {
            console.error(
            `Supplier ${supplierId} failed`,
            err.message
        );
        await insertLog(
            processId,
            eventId,
            supplierId1,
            STATUS.FAILED,            
            `Process failed: ${err.message}`,
            db
        );
        continue
        // return `
        // <html>
        //     <body>
        //         <h3>Failed</h3>
        //         <p>${err.message}</p>
        //     </body>
        // </html>
        // `;
    }
    } //for loop of suppliers end

    await insertLog(
    processId,
    eventId,
    null,
    STATUS.COMPLETED,
    'All suppliers processed',
    db
);
    
}

    
}

async function getSuppliersForEvent(eventId,processId) {
    // Implementation for fetching suppliers for a given event
     const db = await cds.connect.to('db')    
        
       	
        let sql = `
        SELECT DISTINCT
          "SUPPLIERCONTACTEMAIL"                   AS "SupplierId"
        FROM "E510051A0B3B4884BC5E73EDD61D313F"."EVENTSUPPLIERS_REMOTE"        
        WHERE "EVENTID" = ?
      `;      
      const result = await db.run(sql, [eventId]);     
      return result.map(row => row.SupplierId);
}
async function fetchSuppliersFromAriba (eventId,processId) {
    
    const serviceName = 'EVENTMANAGEMENT';
  const destinationName =
    cds.env.requires?.[serviceName]?.credentials?.destination;
  const ariba = await cds.connect.to(serviceName); // subaccount destination
  const destination = await getDestination({ destinationName });
  if (!destination) {
    throw new Error('Destination Eventmanagement not found');
  }
  const apiKey = destination.originalProperties.destinationConfiguration.apikey;
  const realm = destination.originalProperties.destinationConfiguration.realm;
  const user = destination.originalProperties.destinationConfiguration.user;
  const passwordAdapter = destination.originalProperties.destinationConfiguration.passwordAdapter;


    try {

        const url =
      `/${eventId}/supplierInvitations` +
      `?realm=${realm}` +
      `&user=${user}` +
      `&passwordAdapter=${passwordAdapter}`;

    const result = await ariba.send({
      method: 'GET',
      path: url,
      headers: {
        apiKey: apiKey,
        Accept: 'application/json'
      }
    });

    // return result.payload.map(item => ({ item.mainContact.uniqueName.trim() }));
    return result.payload.map(row => row.mainContact.uniqueName);

    } catch (error) {

        console.error(
            'Fetch Suppliers Error:',
            error.response?.data || error.message
        );

        await insertLog(
            processId,
            eventId,
            null,
            STATUS.FAILED,
            `Fetch Suppliers Error: ${error.response?.data || error.message}`,
            db
        );

        throw error;
    }


    

  }

async function triggerExport(eventId, supplierId,processId, db) {

    const {
        destinationName,
        apiKey,
        realm,
        user,
        passwordAdapter,
        baseUrl, clienId, clientSecret, tokenUrl
    } = await getAribaConfig();
    const accessToken = await getAccessTokenCached(tokenUrl, clienId, clientSecret);
    // const ariba = await cds.connect.to('ARIBA'); // subaccount destination

    const url =
        `${baseUrl}/api/sourcing-event-bid/v1/prod/jobs` +
        `?realm=${encodeURIComponent(realm)}` +
        `&user=${encodeURIComponent(user)}` +
        `&passwordAdapter=${encodeURIComponent(passwordAdapter)}`;

    // multipart/form-data body
    const form = new FormData();
    form.append('eventId', eventId);
    form.append('supplierId', supplierId);
    form.append('operation', 'EXPORT');


    // const response = await ariba.send({
    //     method: 'POST',
    //     path: url,
    //     data: form,
    //     headers: {
    //         apiKey: apiKey,
    //         Accept: 'application/json',
    //         ...form.getHeaders() // VERY IMPORTANT          
    //     }
    // });

    try {

        const response = await axios.post(
            url,
            form,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    apiKey: apiKey,
                    Accept: 'application/json',
                    ...form.getHeaders()
                },
                timeout: 60000
            }
        );

        console.log('Ariba Export Response:', response.data);

        return response.data;

    } catch (error) {

        const aribaError =
    error.response?.data
        ? JSON.stringify(error.response.data, null, 2)
        : error.message;

        console.error(
            'Ariba Export Error:',
            aribaError
        );
        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.EXPORT_FAILED,
            `Ariba Export Error: ${aribaError}`,
            //errorMessage: aribaError,
            db
        );

        throw error;
    }

}

async function triggerImport(eventId, supplierId, fileBuffer, processId, db) {

    const {
        apiKey,
        realm,
        user,
        passwordAdapter, baseUrl, clienId, clientSecret, tokenUrl
    } = await getAribaConfig();

    const accessToken = await getAccessTokenCached(tokenUrl, clienId, clientSecret);

    const url =
        `${baseUrl}/api/sourcing-event-bid/v1/prod/jobs` +
        `?realm=${encodeURIComponent(realm)}` +
        `&user=${encodeURIComponent(user)}` +
        `&passwordAdapter=${encodeURIComponent(passwordAdapter)}`;

    // multipart/form-data
    const form = new FormData();

    form.append('eventId', eventId);
    form.append('supplierId', supplierId);
    form.append('operation', 'IMPORT');

    form.append(
        'file',
        fileBuffer,
        {
            filename: 'updated.xlsx',
            contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }
    );

    try {

        const response = await axios.post(
            url,
            form,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    apiKey: apiKey,
                    Accept: 'application/json',
                    ...form.getHeaders()
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 60000
            }
        );

        console.log(
            'Ariba Import Response:',
            response.data
        );

        return response.data;

    } catch (error) {

        console.error(
            'Ariba Import Error:',
            error.response?.data || error.message
        );

        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.IMPORT_FAILED,
            `Ariba Import Error: ${error.response?.data || error.message}`,
            //errorMessage: error.response?.data || error.message,
            db
        );



        throw error;
    }
}

async function triggerSubmit(eventId, supplierId, processId, db) {

    const {
        apiKey,
        realm,
        user,
        passwordAdapter,
        baseUrl, clienId, clientSecret, tokenUrl
    } = await getAribaConfig();

    const accessToken = await getAccessTokenCached(tokenUrl, clienId, clientSecret);

    const url =
        `${baseUrl}/api/sourcing-event-bid/v1/prod/jobs` +
        `?realm=${encodeURIComponent(realm)}` +
        `&user=${encodeURIComponent(user)}` +
        `&passwordAdapter=${encodeURIComponent(passwordAdapter)}`;

    // multipart/form-data
    const form = new FormData();

    form.append('eventId', eventId);
    form.append('supplierId', supplierId);
    form.append('operation', 'SUBMIT');

    try {

        const response = await axios.post(
            url,
            form,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    apiKey: apiKey,
                    Accept: 'application/json',
                    ...form.getHeaders()
                },
                timeout: 60000
            }
        );

        console.log(
            'Ariba Submit Response:',
            response.data
        );

        return response.data;

    } catch (error) {

        console.error(
            'Ariba Submit Error:',
            error.response?.data || error.message
        );

        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.SUBMIT_FAILED,
            `Ariba Submit Error: ${error.response?.data || error.message}`,
            //errorMessage: error.response?.data || error.message,
            db
        );

        throw error;
    }
}

async function downloadFile(jobId, fileId, processId, db) {

    const {
        apiKey,
        realm,
        user,
        passwordAdapter, baseUrl, clienId, clientSecret, tokenUrl
    } = await getAribaConfig();

    const accessToken = await getAccessTokenCached(tokenUrl, clienId, clientSecret);

    const url =
        `${baseUrl}/api/sourcing-event-bid/v1/prod/jobs/${jobId}/files/${fileId}` +
        `?realm=${encodeURIComponent(realm)}` +
        `&user=${encodeURIComponent(user)}` +
        `&passwordAdapter=${encodeURIComponent(passwordAdapter)}`;

    try {

        const response = await axios.get(
            url,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    apiKey: apiKey,
                    Accept: '*/*'
                },
                responseType: 'arraybuffer', // IMPORTANT for file download
                timeout: 60000
            }
        );

        return Buffer.from(response.data);

    } catch (error) {

        console.error(
            'Ariba Download Error:',
            error.response?.data || error.message
        );

        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.FILE_DOWNLOAD_FAILED,
            `File Download Error: ${error.response?.data || error.message}`,
            //errorMessage: error.response?.data || error.message,
            db
        );

        throw error;
    }
}
async function saveDownloadedFile(buffer, fileName) {

    const downloadDir = path.join(__dirname, '../downloads');

    // create folder if not exists
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
    }

    const filePath = path.join(downloadDir, fileName);

    fs.writeFileSync(filePath, buffer);

    //console.log(`File saved at: ${filePath}`);

    return filePath;
}




async function updateExcel(buffer) {

    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(buffer);

    const sheet =
        workbook.getWorksheet(
            '5 TECHNICAL ENVELOPE'
        );
    //sheet.getCell('E8').value = 'No';



    return await workbook.xlsx.writeBuffer();
}


function getJobUrl() {



    return `${process.env.ARIBA_BASE_URL}/api/sourcing-event-bid/v1/prod/jobs?realm=${process.env.ARIBA_REALM}&user=${process.env.ARIBA_USER}&passwordAdapter=${process.env.ARIBA_PASSWORD_ADAPTER}`;
}

function getHeaders(form) {

    return {
        ...form?.getHeaders?.(),
        apiKey: process.env.ARIBA_API_KEY,
        Authorization: `Bearer ${process.env.ARIBA_TOKEN}`
    };
}

async function updateLog(ID, data, db) {

    // await UPDATE('cost.distribution.ProcessLog')
    //     .set(data)
    //     .where({ ID });

        // const db = await cds.connect.to('db');

    await db.run(
        UPDATE('cost.distribution.ProcessLog')
            .set(data)
            .where({ ID })
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
    //const db = await cds.connect.to('db');

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
    startProcess
};