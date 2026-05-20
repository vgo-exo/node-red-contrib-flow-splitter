const path = require('path')
const fs = require('fs')
const manager = require('flows-file-manager')
const eol = require('eol')

/**
 * Here we define some types to allow the IDE to provide us with autocompletion.
 * Some are documented directly by the nodered team, but some are not.
 * 
 * That's why we also made an `index.d.ts` for undocumented types we need to manipulate.
 * Those are defined by analyzing the node-red code and some logging of those objects.
 * In this regard, the types defined by ourselves might be incomplete.
 * 
 * @typedef {import('./index').noderedEvent.FlowStartedEvent} FlowStartedEventType
 * @typedef {import('./index').noderedEvent.ExtendedNodeDef} ExtendedNodeDef
 * @typedef {import("node-red").NodeRedApp} REDType
 */


/**
 * Exposing the RED runtime globally to avoid passing it in every function.
 * @type {REDType}
 */
let RED

const splitCfgFilename = '.config.flow-splitter.json'
const DEFAULT_CFG = {
    fileFormat: 'yaml',
    destinationFolder: 'src',
    tabsOrder: [],
    monolithFilename: "flows.json"
};

function writeSplitterConfig(cfg, projectPath) {
    RED.log.info("[node-red-contrib-flow-splitter] Writing new config")
    try {
        const splitterCfgToWrite = JSON.parse(JSON.stringify(cfg))
        delete splitterCfgToWrite.monolithFilename
        fs.writeFileSync(path.join(projectPath, splitCfgFilename), eol.auto(JSON.stringify(splitterCfgToWrite, null, 2)));
    } catch (error) {
        RED.log.warn(`[node-red-contrib-flow-splitter] Could not write splitter config '${splitCfgFilename}': ${error}`)
    }
    finally {
        return
    }
}


/**
 * @param {REDType} REDRuntime 
*/
module.exports = function (REDRuntime) {
    RED = REDRuntime

    // We register the pluggin for NodeRed
    RED.plugins.registerPlugin("node-red-contrib-flow-splitter", {
        type: "exotec-deploy-plugins",
        onadd: function () {
            RED.log.info("[node-red-contrib-flow-splitter] Initialized plugin successfully")
        },

    })

    // Code to launch on every restart of the flows = boot or deploy event
    RED.events.on('flows:started', onFlowReload);
}


/**
 * Main function. To be executed on each flow restart
 * @param {FlowStartedEventType} flowEventData
 * @returns {void}
*/
async function onFlowReload(flowEventData) {
    RED.log.info("[node-red-contrib-flow-splitter] Flow restart event")

    const userDir = path.join(RED.settings.userDir)

    if (!fs.existsSync(path.join(userDir || '.', '.config.projects.json'))) {
        RED.log.error("[node-red-contrib-flow-splitter] Cannot find '.config.projects.json' file, the package may have been install in the wrong package.json")
        return
    }

    const nrProjectsCfg = JSON.parse(fs.readFileSync(path.join(userDir, '.config.projects.json')))
    const projectPath = path.join(userDir, 'projects', nrProjectsCfg.activeProject)

    DEFAULT_CFG.monolithFilename = RED.settings.flowFile

    let currentProjectSplitterCfg
    let flowSet

    RED.log.info("[node-red-contrib-flow-splitter] Fetching current splitter config")
    currentProjectSplitterCfg = DEFAULT_CFG
    if (fs.existsSync(path.join(projectPath, splitCfgFilename))) {
        currentProjectSplitterCfg = JSON.parse(fs.readFileSync(path.join(projectPath, splitCfgFilename)))
        currentProjectSplitterCfg.monolithFilename = currentProjectSplitterCfg.monolithFilename || RED.settings.flowFile || 'flows.json'
    }

    if (flowEventData.config.flows.length == 0) {
        // The flow file registered in the package.json does not exist or is empty.
        // The script will rebuild the flows from the split source files and push the resulting flow file to RED runtime.

        RED.log.info("[node-red-contrib-flow-splitter] Rebuilding monolith file from splitter config and source files")
        flowSet = manager.constructFlowSetFromTreeFiles(currentProjectSplitterCfg || DEFAULT_CFG, projectPath)

        if (!flowSet) {
            RED.log.error("[node-red-contrib-flow-splitter] Cannot build FlowSet from source tree files")
            return
        }

        currentProjectSplitterCfg = manager.constructMonolithFileFromFlowSet(flowSet, currentProjectSplitterCfg || DEFAULT_CFG, projectPath, false)
        writeSplitterConfig(currentProjectSplitterCfg, projectPath)

        /**
         * A little trick to require the same "node-red" API to give private access to our own modulesContext. (trick given in monogoto.io project)
         * @type {REDType}
        */
        const PRIVATE_RED = (function requireExistingNoderedInstance() {
            for (const child of require.main.children) {
                if (child.filename.endsWith('red.js')) {
                    return require(child.filename);
                }
            }
            // In case node-red was not required before, just require it
            return require('node-red');
        })();

        RED.log.info("[node-red-contrib-flow-splitter] Stopping and loading nodes")

        PRIVATE_RED.nodes.loadFlows(true).then(function () {
            RED.log.info("[node-red-contrib-flow-splitter] Flows are rebuilt and available")
        })
        return
    }

    else {
        // Content in the reload of the flows has been found
        // The script will split the flows into split source files and overwrite the splitter config and delete the monolithic flow file.

        flowSet = manager.constructFlowSetFromMonolithObject(flowEventData.config.flows)

        currentProjectSplitterCfg = manager.constructTreeFilesFromFlowSet(flowSet, currentProjectSplitterCfg || DEFAULT_CFG, projectPath)
        writeSplitterConfig(currentProjectSplitterCfg, projectPath)

        try {
            const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
            await delay(150) /// waiting 150ms to be sure the newly deployed flowFile is created by Node-RED before erasing it.
            fs.unlinkSync(path.join(projectPath, RED.settings.flowFile))
        } catch (error) {
            RED.log.warn(`[node-red-contrib-flow-splitter] Cannot erase file '${RED.settings.flowFile}'`)
        }
        finally {
            return
        }
    }

}
