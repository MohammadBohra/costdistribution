sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageToast) {
    "use strict";

    return Controller.extend("com.aramco.costdistrbutionui.controller.View1", {

        onInit: function () {

            const oViewModel = new JSONModel({
                logs: [],
                busy: false,
                currentStatus: "Click on Start Process to trigger...",
                statusState: "Information",
                lastUpdated: "",
                finalMessage: "",
                messageType: "Information",
                showFinalMessage: false
            });

            this.getView().setModel(oViewModel, "viewModel");

            // Read URL parameters from Ariba
            const oParams = new URLSearchParams(window.location.search);
            this._eventId = oParams.get("eventId");
            this._supplierId = oParams.get("supplierId");

        },

        onStartProcess: function () {
            if (!this._eventId || !this._supplierId) {
                MessageToast.show("Missing required parameters");
                return;
            }
            const oViewModel = this.getView().getModel("viewModel");

            oViewModel.setProperty("/busy", true);
            oViewModel.setProperty("/currentStatus", "Process Status: Running. This may take a few moments...");
            oViewModel.setProperty("/statusState", "Information");
            oViewModel.setProperty("/showFinalMessage", false);

            this._triggerDistribution(
                this._eventId,
                this._supplierId
            );

        },

        _triggerDistribution: async function (eventId, supplierId) {
            const that = this;
            const sServiceUrl =
                this.getOwnerComponent().getModel().sServiceUrl

            const tokenResponse = await fetch(
                sServiceUrl,
                {
                    method: "GET",
                    headers: {
                        "X-CSRF-Token": "Fetch"

                    }
                }
            );

            const csrfToken =
                tokenResponse.headers.get("X-CSRF-Token");
            fetch(sServiceUrl + "/triggerDistribution", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": csrfToken
                },
                body: JSON.stringify({
                    eventId: eventId,
                    supplierId: supplierId
                })
            })
                .then(response => response.json())
                .then(data => {
                    // Action triggered successfully
                    const processId = data.processId;

                    MessageToast.show(
                        `Distribution triggered. Process ID: ${processId}`
                    );

                    that._processId = processId;
                    const oViewModel = that.getView().getModel("viewModel");
                    oViewModel.setProperty("/processId", processId);
                    oViewModel.setProperty("/eventId", eventId);
                    oViewModel.setProperty("/supplierId", supplierId);


                    that._startPolling(processId);

                })
                .catch(err => {
                    console.error(err);
                    MessageToast.show("Error triggering distribution");
                });
        },

        _startPolling: function (processId) {
            const that = this;

            this._interval = setInterval(function () {
                that._fetchLogs(processId);
            }, 10000); // every 10 seconds
        },








        _fetchLogs: function (processId) {
            const that = this;

            const oViewModel = this.getView().getModel("viewModel");


            oViewModel.setProperty("/busy", true);
            const sServiceUrl =
                this.getOwnerComponent().getModel().sServiceUrl
            const url =
                `${sServiceUrl}/ProcessLog?$filter=processId eq '${processId}'&$orderby=createdAt desc`;

            fetch(url)
                .then(res => res.json())
                .then(data => {

                    const logs = data.value || [];

const filteredLogs = [];
let exportPendingSeen = false;

logs.forEach(log => {

    const isExportPending =
        log.status === "JOB_STATUS_UPDATE" &&
        log.errorMessage === "EXPORT job status: Pending";

    if (isExportPending) {

        if (!exportPendingSeen) {
            filteredLogs.push(log);
            exportPendingSeen = true;
        }

    } else {
        filteredLogs.push(log);
    }
});

oViewModel.setProperty("/logs", filteredLogs);

                    if (logs.length > 0) {

                        const latest = logs[0];

                        // ✅ LIVE STATUS
                        oViewModel.setProperty("/currentStatus", latest.status);
                        oViewModel.setProperty("/lastUpdated", new Date().toLocaleTimeString());

                        // ✅ STATUS COLOR
                        let state = "Information";

                        if (latest.status === "SUBMIT_COMPLETED") {
                            state = "Success";
                        } else if (latest.status === "FAILED") {
                            state = "Error";
                        } else {
                            state = "Warning";
                        }

                        oViewModel.setProperty("/statusState", state);

                        // ✅ STOP CONDITION
                        if (
                            latest.status === "SUBMIT_COMPLETED" ||
                            latest.status === "FAILED"
                        ) {
                            clearInterval(this._interval);
                            this._interval = null;

                            oViewModel.setProperty("/busy", false);

                            oViewModel.setProperty("/finalMessage", latest.errorMessage || latest.message);
                            oViewModel.setProperty("/messageType", state);
                            oViewModel.setProperty("/showFinalMessage", true);
                        }
                    }

                })
                .catch(err => {
                    console.error(err);
                    oViewModel.setProperty("/busy", false);
                });
        }

    });
});
