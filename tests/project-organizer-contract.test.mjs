import test from 'node:test';
import assert from 'node:assert/strict';
import { runProjectOrganizerAdapterContract } from '@tigao/organizer-contract-tests';
import { createCppOrganizerContractHarness } from './project-organizer-contract-harness.mjs';

runProjectOrganizerAdapterContract({ test, assert, createHarness: createCppOrganizerContractHarness });
