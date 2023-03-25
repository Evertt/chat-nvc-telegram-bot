export const isBotAskingForDonation = (text: string) => {
  const mentionsOne = /1|one/i.test(text)
  const mentionsTwo = /2|two/i.test(text)
  const mentionsFour = /4|four/i.test(text)
  const mentionsDollar = /dollar/i.test(text)
  const mentionsDonate = /donate|donation/i.test(text)
  const mentionsRequest = /request/i.test(text)

  return mentionsOne
    && mentionsTwo
    && mentionsFour
    && mentionsDollar
    && mentionsDonate
    && mentionsRequest
}