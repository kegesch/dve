import { describe, test, expect } from 'bun:test'
import type {
  Assumption,
  Decision,
  SessionStateRecord,
} from '../../domain/types'
import { KnowledgeGraph } from '../../domain/graph/knowledge-graph'
import { buildDecompositionContext } from '../../application/engine/decomposition'
import {
  buildStressTestContext,
  rankAssumptions,
} from '../../application/engine/stress-testing'
import {
  buildSpikePlanningContext,
  generateSpikeProposal,
} from '../../application/engine/spike-planning'
import { findInvalidatedAssumptions } from '../../domain/graph/queries'
import { tokenize } from '../../cli/commands/new'
