import { vi } from 'vitest'

const {
  mockGetSession,
  mockSignInWithPassword,
  mockSignOut,
  mockOnAuthStateChange,
  mockFrom,
  mockRpc,
  mockStorageFrom,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSignInWithPassword: vi.fn(),
  mockSignOut: vi.fn(),
  mockOnAuthStateChange: vi.fn(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockStorageFrom: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
      onAuthStateChange: mockOnAuthStateChange,
    },
    from: mockFrom,
    rpc: mockRpc,
    storage: {
      from: mockStorageFrom,
    },
  },
}))

export {
  mockGetSession,
  mockSignInWithPassword,
  mockSignOut,
  mockOnAuthStateChange,
  mockFrom,
  mockRpc,
  mockStorageFrom,
}
