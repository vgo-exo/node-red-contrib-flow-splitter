const fs = require('node:fs')
const path = require('node:path')
const eol = require('eol')
const manager = require('flows-file-manager')

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

const PREFIX = '[node-red-contrib-flow-splitter]'

/** @type {{ info: (msg: string) => void, warn: (msg: string) => void, error: (msg: string) => void }} */
let logger

const splitCfgFilename = '.config.flow-splitter.json'
const DEFAULT_CFG = {
    fileFormat: 'yaml',
    destinationFolder: 'src',
    tabsOrder: [],
    monolithFilename: 'flows.json',
}

function writeSplitterConfig(cfg, projectPath) {
    logger.info('Writing new config')
    try {
        const splitterCfgToWrite = JSON.parse(JSON.stringify(cfg))
        delete splitterCfgToWrite.monolithFilename
        fs.writeFileSync(path.join(projectPath, splitCfgFilename), eol.auto(JSON.stringify(splitterCfgToWrite, null, 2)))
    }
    catch (error) {
        logger.warn(`Could not write splitter config '${splitCfgFilename}': ${String(error)}`)
    }
    finally { /* empty */ }
}

/**
 * @param {REDType} REDRuntime 
 */
module.exports = function (REDRuntime) {
    RED = REDRuntime

    logger = {
        info: msg => RED.log.info(`${PREFIX} ${msg}`),
        warn: msg => RED.log.warn(`${PREFIX} ${msg}`),
        error: msg => RED.log.error(`${PREFIX} ${msg}`),
    }

    // We register the plugin for NodeRed
    RED.plugins.registerPlugin('node-red-contrib-flow-splitter', {
        type: 'exotec-deploy-plugins',
        onadd() {
            logger.info('Initialized plugin successfully')
        },

    })

    // Code to launch on every restart of the flows = boot or deploy event
    RED.events.on('flows:started', onFlowReload)
}

/**
 * Main function. To be executed on each flow restart
 * @param {FlowStartedEventType} flowEventData
 * @returns {void}
 */
async function onFlowReload(flowEventData) {
    logger.info('Flow restart event')

    const userDir = path.join(RED.settings.userDir)
    let projectPath

    const projectsConfigFile = path.join(userDir || '.', '.config.projects.json')

    if (fs.existsSync(projectsConfigFile)) {
        // Projects are enabled, use existing logic
        const nrProjectsCfg = JSON.parse(fs.readFileSync(projectsConfigFile))
        projectPath = path.join(userDir, 'projects', nrProjectsCfg.activeProject)
        logger.info(`Projects enabled. Active project path: ${projectPath}`)
    }
    else {
        // Projects are not enabled, use userDir as the base path
        projectPath = userDir
        logger.info(`Projects not enabled. Using userDir as base path: ${projectPath}`)
    }

    DEFAULT_CFG.monolithFilename = RED.settings.flowFile

    let currentProjectSplitterCfg
    let flowSet

    logger.info('Fetching current splitter config')
    currentProjectSplitterCfg = DEFAULT_CFG
    if (fs.existsSync(path.join(projectPath, splitCfgFilename))) {
        currentProjectSplitterCfg = JSON.parse(fs.readFileSync(path.join(projectPath, splitCfgFilename)))
        currentProjectSplitterCfg.monolithFilename = currentProjectSplitterCfg.monolithFilename || RED.settings.flowFile || 'flows.json'
    }

    if (flowEventData.config.flows.length === 0) {
        // The flow file registered in the package.json does not exist or is empty.
        // The script will rebuild the flows from the split source files and push the resulting flow file to RED runtime.

        logger.info('Rebuilding monolith file from splitter config and source files')
        flowSet = manager.constructFlowSetFromTreeFiles(currentProjectSplitterCfg || DEFAULT_CFG, projectPath)

        if (!flowSet) {
            logger.error('Cannot build FlowSet from source tree files')
            return
        }

        currentProjectSplitterCfg = manager.constructMonolithFileFromFlowSet(flowSet, currentProjectSplitterCfg || DEFAULT_CFG, projectPath, false)
        writeSplitterConfig(currentProjectSplitterCfg, projectPath)

        /**
         * We need the *initialized* node-red instance to call `nodes.loadFlows()`.
         * In typical Docker setups (e.g. nodered/node-red), the host runtime lives
         * in `/usr/src/node-red/node_modules/` while plugins are installed to
         * `/data/node_modules/`. A plain `require('node-red')` would resolve to an
         * uninitialized copy. Instead, we look up the already-loaded red.js module
         * from the main process's requirement cache.
         * @type {REDType}
         */
        const PRIVATE_RED = (function requireInitializedNoderedInstance() {
            const loaded = require.main.children.find(child => child.filename.endsWith('red.js'))
            if (loaded) {
                return require(loaded.filename)
            }
            return require('node-red')
        })()

        logger.info('Stopping and loading nodes')

        PRIVATE_RED.nodes.loadFlows(true).then(() => {
            logger.info('Flows are rebuilt and available')
        })
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
        }
        catch (error) {
            logger.warn(`Cannot erase file '${RED.settings.flowFile}': ${String(error)}`)
        }
        finally { /* empty */ }
    }
}
