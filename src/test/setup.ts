import '@testing-library/jest-dom'
import { vi } from 'vitest'

globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock')
globalThis.URL.revokeObjectURL = vi.fn()

// Radix UI uses pointer/scroll APIs not implemented in jsdom
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = vi.fn(() => false)
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = vi.fn()
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = vi.fn()
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}
