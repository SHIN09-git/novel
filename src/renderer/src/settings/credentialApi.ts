import { getNovelDirectorCredentialsApi } from '../platform/novelDirectorBridge'

export function getApiKeyState(baseUrl?: string) {
  return getNovelDirectorCredentialsApi().hasApiKey(baseUrl)
}

export async function saveApiKey(apiKey: string, baseUrl: string): Promise<boolean> {
  const result = await getNovelDirectorCredentialsApi().setApiKey(apiKey, baseUrl)
  return result.hasApiKey
}

export async function deleteApiKey(): Promise<boolean> {
  const result = await getNovelDirectorCredentialsApi().deleteApiKey()
  return result.hasApiKey
}
