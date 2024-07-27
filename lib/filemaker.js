const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const eol = require('eol');
const { logger } = require('./logger');

REGEX_YAML = new RegExp('\.(yaml|yml)$');
REGEX_JSON = new RegExp('\.json$');

/**
 * 
 */
class FileMaker {
  constructor(srcPath, flowSet, fileFormat) {
    this.srcPath = srcPath;
    this.flowSet = flowSet;
    this.fileFormat = fileFormat;
  }

  /**
   * Checks if the constructor parameter flowSet is viable to split files, then calls makeSrcFile() 
   * @returns {boolean} true if the operation succeeded, false otherwise 
   */
  createSplitFiles() {
    if (!('config-nodes' in this.flowSet) || !('tabs' in this.flowSet) || !('subflows' in this.flowSet)) {
      logger.error("Given flowSet is not a viable crafted set")
      return false
    }
    else {
      this.flowSet.tabs.forEach(tab => {
        this.makeSrcFile(path.join('tabs', tab.normalizedName), tab.content, this.fileFormat)
      });
      this.flowSet.subflows.forEach(subflow => {
        this.makeSrcFile(path.join('subflows', subflow.normalizedName), subflow.content, this.fileFormat)
      });
      this.flowSet['config-nodes'].forEach(node => {
        this.makeSrcFile(path.join('config-nodes', node.normalizedName), node.content, this.fileFormat)
      });
      return true
    }
  }

  /**
   * Generate a JSON or YAML file to be stored into this.srcPath
   * @param {string} name : Name of the file (can include '/' to be saved into sub-directories)
   * @param {object} content : JSON content of the file to generate
   * @param {string} fileFormat : output file format (JSON or YAML)
   * @returns {undefined}
   */
  makeSrcFile(name, content, fileFormat) {
    var data;
    if (fileFormat === 'yaml') {
      data = yaml.dump(content, { quotingType: '"' });
    }
    else if (fileFormat === 'json') {
      data = eol.auto(JSON.stringify(content, null, 2));
    }
    else {
      logger.error("Unsupported file extension")
      return
    }
    try {
      fs.writeFileSync(path.join(this.srcPath, `${name}.${fileFormat}`), data);
    } catch (error) {
      logger.error(`Could not create src files : ${error}`)
      return
    }
  }

}

/**
 * Remove a directory
 * @param {string} path Path of the folder to recursively remove
 * @returns {boolean} true if it suceeds, false otherwise
 */
function clearSrcFolder(path) {
  try {
    fs.rmSync(path, { recursive: true })
  } catch (error_try) {
    logger.error(error_try)
    return false
  }
  finally {
    return true
  }
};

/**
 * Completely rebuild flows.json as parsed object and keeping tab order and sorting all other nodes
 * @param {*} projectPath 
 * @param {*} config 
 * @returns {Array}
 */
function rebuildFlowsJson(projectPath, config) {
  // Check source files existence
  if (!fs.existsSync(path.join(projectPath, config.destinationFolder)) ||
    !fs.existsSync(path.join(projectPath, config.destinationFolder, 'tabs')) ||
    !fs.existsSync(path.join(projectPath, config.destinationFolder, 'subflows')) ||
    !fs.existsSync(path.join(projectPath, config.destinationFolder, 'config-nodes'))
  ) {
    logger.error(`Missing source files in : '${config.destinationFolder}'`);
    return null
  }

  // Construct flows.json file
  flowFile = [];
  tabs = parseSrcFile(path.join(projectPath, config.destinationFolder, 'tabs'), config)
  subflows = parseSrcFile(path.join(projectPath, config.destinationFolder, 'subflows'), config)
  configNodes = parseSrcFile(path.join(projectPath, config.destinationFolder, 'config-nodes'), config)
  var fullFlows = flowFile.concat(tabs).concat(subflows).concat(configNodes)

  // Re-order the nodes given the config
  var orderedFullFlows = [];
  var orderedIndexes = [];
  var remainingNodes = [];
  if ('tabsOrder' in config && config.tabsOrder.length > 0) {
    for (let i = 0; i < config.tabsOrder.length; i++) {
      for (let j = 0; j < fullFlows.length; j++) {
        if ('id' in fullFlows[j] && config.tabsOrder[i] === fullFlows[j].id) {
          orderedFullFlows.push(fullFlows[j]);
          orderedIndexes.push(j);
          break;
        }
      }
    }
    for (let k = 0; k < fullFlows.length; k++) {
      if (!orderedIndexes.includes(k)) {
        remainingNodes.push(fullFlows[k]);
      }
    }
    return orderedFullFlows = orderedFullFlows.concat(remainingNodes)
  }
  else {
    return fullFlows
  }
}

/**
 * Rebuild flows.json type object from src folder 
 * @param {string} folderSrc Path to the src folder
 * @param {Config} config Config Object
 * @returns {object} rebuilt flows
 */
function parseSrcFile(folderSrc, config) {
  mergedObj = [];
  try {
    fs.readdirSync(folderSrc).forEach(file => {
      if (config.fileFormat === "yaml") {
        if (file && REGEX_YAML.test(file)) {
          try {
            yamlObj = yaml.load(fs.readFileSync(path.join(folderSrc, file)));
            mergedObj = mergedObj.concat(yamlObj)
          } catch (error) {
            logger.error(`Could not add the content of '${file}' : ${error}`)
          }
        }
      }
      else if (config.fileFormat === "json") {
        if (file && REGEX_JSON.test(file)) {
          try {
            jsonObj = JSON.parse(fs.readFileSync(path.join(folderSrc, file)));
            mergedObj = mergedObj.concat(jsonObj)
          } catch (error) {
            logger.error(`Could not add the content of '${file}' : ${error}`)
          }
        }
      }
      else {
        throw BreakException
      }
    })
  } catch (forEachError) {
    if (forEachError == BreakException) {
      logger.error(`Unexpected file format in the config file : ${config.fileFormat}`)
      return null
    } else {
      logger.error(`Unexpected error happened while parsing a source folder : ${forEachError}`)
      return null
    };
  } finally {
    return mergedObj
  }
}

/**
 * Create a flows.json type file, given the data, the path and the name of the file 
 * @param {object} data content of the JSON to write
 * @param {string} projectPath 
 * @param {string} fileName 
 * @returns {boolean} true if succeeds, false otherwise
 */
function makeFlowsJson(data, projectPath, fileName) {
  try {
    fs.writeFileSync(path.join(projectPath, fileName), eol.auto(JSON.stringify(data, null, 2)));
    return true
  } catch (error) {
    logger.error(`Error while writing file : ${error}`)
    return false
  }
}

/**
 * Create the splitter config file
 * @param {Project} project
 * @param {string} cfgName name of the splitter config file
 * @param {object} cfgObject splitter config JSON parsed as an object
 * @returns {boolean} true if succeeds, false otherwise
 */
function makeOrUpdateCfg(project, cfgName, cfgObject) {
  try {
    fs.writeFileSync(path.join(project.path, cfgName), eol.auto(JSON.stringify(cfgObject, null, 2)));
  } catch (error) {
    logger.debug(error)
    return false
  }
  return true
}


module.exports = {
  FileMaker,
  clearSrcFolder,
  rebuildFlowsJson,
  makeFlowsJson,
  makeOrUpdateCfg,
};