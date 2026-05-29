import { getNovelDirectorCredentialsApi } from '../platform/novelDirectorBridge'

export async function getApiKeyState(): Promise<boolean> {
  const result = await getNovelDirectorCredentialsApi().hasApiKey()
  return result.hasApiKey
}

export async function saveApiKey(apiKey: string): Promise<boolean> {
  const result = await getNovelDirectorCredentialsApi().setApiKey(apiKey)
  return result.hasApiKey
}

export async function deleteApiKey(): Promise<boolean> {
  const result = await getNovelDirectorCredentialsApi().deleteApiKey()
  return result.hasApiKey
}
