import type { NodeDef } from '@node-red/registry'

/**
 * This typings files is made to ease developpement of plugins by defining types that are not defined by the NodeRed libraries.
 * When a type is defined by the nodered lib but needs to be extended, it is also done here.
 */

export namespace noderedEvent {
    export interface FlowStartedEvent {
        config: FlowConfig
        type: 'flows' | 'node' | 'full'
        diff?: FlowDiff
    }

    export interface FlowDiff {
        added: [string]
        changed: [string]
        removed: [string]
        rewired: [string]
        linked: [string]
    }

    export interface FlowConfig {
        flows: [ExtendedNodeDef]
        rev: string
    }

    export interface ExtendedNodeDef extends NodeDef {
        [key: string]: any
    }
}
