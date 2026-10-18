const API = 'https://api.brevo.com/v3'

export async function updateBrevoContactAttribute(
  apiKey: string,
  email: string,
  attributes: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(`${API}/contacts/${encodeURIComponent(email)}?identifierType=emailId`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({ attributes }),
  })
  if (response.status === 204 || response.ok) return
  const text = await response.text()
  let message = `Brevo HTTP ${response.status}`
  try {
    const json = text ? (JSON.parse(text) as { message?: string }) : null
    if (json?.message) message = json.message
  } catch {
    /* keep status message */
  }
  throw new Error(message)
}
