import { vi } from 'vitest'

const {
  mockGetSession,
  mockSignInWithPassword,
  mockSignOut,
  mockOnAuthStateChange,
  mockFrom,
  mockRpc,
  mockStorageFrom,
  mockChannel,
  mockRemoveChannel,
} = vi.hoisted(() => {
  const mockChannelObj = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  }
  return {
    mockGetSession: vi.fn(),
    mockSignInWithPassword: vi.fn(),
    mockSignOut: vi.fn(),
    mockOnAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
    mockFrom: vi.fn(),
    mockRpc: vi.fn(),
    mockStorageFrom: vi.fn(),
    mockChannel: vi.fn().mockReturnValue(mockChannelObj),
    mockRemoveChannel: vi.fn(),
  }
})

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
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
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
  mockChannel,
  mockRemoveChannel,
}
