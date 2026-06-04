// const axios = require('axios');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const FormData = require('form-data');
const cds = require('@sap/cds');

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


async function startProcess(service, eventId, supplierId, triggeredBy) {

    // const db = await cds.connect.to('db');

    // const existing = await SELECT.one
    //     .from('cost.distribution.ProcessLog')
    //     .where({
    //         eventId,
    //         supplierId
    //     })
    //     .orderBy('createdAt desc');
    const db = await cds.connect.to('db');
const { SELECT } = cds.ql;

const FINAL_STATUSES = [
    STATUS.SUBMIT_COMPLETED,
    STATUS.SUBMIT_FAILED,
    STATUS.FAILED
];

const latestProcess = await db.run(
  SELECT.one
    .from('cost.distribution.ProcessLog')
    .columns('processId')
    .where({ eventId, supplierId })
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
          in: [
            STATUS.SUBMIT_COMPLETED,
            STATUS.SUBMIT_FAILED,
            STATUS.FAILED
          ]
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
// const active = await db.run(
//     SELECT.one
//         .from('cost.distribution.ProcessLog')
//         .where({ eventId, supplierId })
//         .where('status not in', FINAL_STATUSES)
//         .orderBy('createdAt desc')
// );
// if (active) {
//     return {
//         processId: active.processId,
//         status: active.status
//     };
// }

// const existing = await db.run(
//     SELECT.one.from('cost.distribution.ProcessLog')
//         .where({
//             eventId,
//             supplierId
//         })
//         .where(
//             `status not in`,
//             [
//                 'SUBMIT_COMPLETED',
//                 'SUBMIT_FAILED',
//                 'FAILED'
//             ]
//         )
//         .orderBy('createdAt desc')
// );

//     // Prevent duplicate running process
//     if (existing &&
//         [
//             STATUS.REQUEST_RECEIVED,
//             STATUS.EXPORT_TRIGGERED,
//             STATUS.EXPORT_IN_PROGRESS,
//             STATUS.IMPORT_TRIGGERED,
//             STATUS.IMPORT_IN_PROGRESS,
//             STATUS.SUBMIT_TRIGGERED,
//             STATUS.SUBMIT_IN_PROGRESS,
//             STATUS.JOB_STATUS_UPDATE
//         ].includes(existing.status)) {
//             return {
//         processId: existing.processId,
//         status: existing.status
//     };

//         return `
//         <html>
//             <body>
//                 <h3>Request In Progress</h3>
//                 <p>Current status: ${existing.status}</p>
//             </body>
//         </html>
//         `;
//     }
    const processId = cds.utils.uuid();
    // Create Log
    const log = {
        ID: cds.utils.uuid(),
        processId,
        eventId,
        supplierId,
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
        supplierId,
        triggeredBy
    ).catch(console.error);

    return {
        processId,
        status: 'STARTED'
    };


    async function runProcess(
    processId,
    eventId,
    supplierId,
    triggeredBy
) {
    try {

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

        // await updateLog(log.ID, {
        //     status: STATUS.EXPORT_COMPLETED,
        //     exportFileId: exportStatus.fileId
        // });
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


        // await updateLog(log.ID, {
        //     status: STATUS.FILE_DOWNLOADED
        // });
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

        // await updateLog(log.ID, {
        //     status: STATUS.IMPORT_TRIGGERED,
        //     importJobId: importResult.jobId
        // });

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

        // await updateLog(log.ID, {
        //     status: STATUS.IMPORT_COMPLETED,db
        // });

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

        // await updateLog(log.ID, {
        //     status: STATUS.SUBMIT_TRIGGERED,
        //     submitJobId: submitResult.jobId
        // });

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

        // await updateLog(log.ID, {
        //     status: STATUS.SUBMIT_COMPLETED,
        //     completedAt: new Date()
        // });

        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.SUBMIT_COMPLETED,
           
            'Submit completed successfully. Cost distribution process finished.',
            db
        );

        return `
        <html>
            <body>
                <h3>Completed</h3>
                <p>Cost distribution completed successfully.</p>
            </body>
        </html>
        `;

    } catch (err) {

        // await updateLog(log.ID, {
        //     status: STATUS.FAILED,
        //     errorMessage: err.message
        // });

        await insertLog(
            processId,
            eventId,
            supplierId,
            STATUS.FAILED,            
            `Process failed: ${err.message}`,
            //errorMessage: err.message,
            db
        );

        return `
        <html>
            <body>
                <h3>Failed</h3>
                <p>${err.message}</p>
            </body>
        </html>
        `;
    }
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