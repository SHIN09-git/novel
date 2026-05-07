export async function getApiKeyState(): Promise<boolean> {
  const result = await window.novelDirector.credentials.hasApiKey()
  return result.hasApiKey
}

export async function saveApiKey(apiKey: string): Promise<boolean> {
  const result = await window.novelDirector.credentials.setApiKey(apiKey)
  return result.hasApiKey
}

export async function deleteApiKey(): Promise<boolean> {
  const result = await window.novelDirector.credentials.deleteApiKey()
  return result.hasApiKey
}
