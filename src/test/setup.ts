import '@testing-library/jest-dom'
import { vi } from 'vitest'

globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock')
globalThis.URL.revokeObjectURL = vi.fn()
