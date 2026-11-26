import { toDataURL } from 'qrcode'

export function qrDataUrl(text: string): Promise<string> {
  return toDataURL(text, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#102033', light: '#ffffff' },
  })
}
