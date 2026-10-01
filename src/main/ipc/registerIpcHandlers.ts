import type { IAIService } from '../services/AIService'
import { registerAgentAuthorizationIpcHandlers } from './agentAuthorizationIpcHandlers'
import { DiagnosticsService } from '../services/DiagnosticsService'
import { registerAiIpcHandlers } from './aiIpcHandlers'
import { registerBackupIpcHandlers } from './backupIpcHandlers'
import { registerCredentialIpcHandlers } from './credentialIpcHandlers'
import { registerDataIpcHandlers } from './dataIpcHandlers'
import { registerDiagnosticsIpcHandlers } from './diagnosticsIpcHandlers'
import type { StorageDataOperationContext } from './storageDataOperations'
import { registerStorageManagementIpcHandlers } from './storageManagementIpcHandlers'
import { registerUtilityIpcHandlers } from './utilityIpcHandlers'

interface IpcHandlerContext extends StorageDataOperationContext {
  aiService: IAIService
}

export function registerIpcHandlers(context: IpcHandlerContext): void {
  const diagnosticsService = new DiagnosticsService(context.aiService)
  registerCredentialIpcHandlers(context.credentialService)
  registerAiIpcHandlers(context.aiService)
  registerBackupIpcHandlers(context)
  registerDataIpcHandlers(context)
  registerDiagnosticsIpcHandlers(diagnosticsService)
  registerStorageManagementIpcHandlers(context)
  registerUtilityIpcHandlers()
  registerAgentAuthorizationIpcHandlers(context)
}
