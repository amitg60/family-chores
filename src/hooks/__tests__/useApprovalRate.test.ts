import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockRpc } from '../../test/mocks/supabase'
import { useApprovalRate } from '../useApprovalRate'

describe('useApprovalRate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockRpc.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useApprovalRate())
    expect(result.current.loading).toBe(true)
    expect(result.current.approved).toBe(0)
    expect(result.current.total).toBe(0)
    expect(result.current.rate).toBeNull()
  })

  it('returns approval stats on success', async () => {
    mockRpc.mockResolvedValue({
      data: [{ approved: 9, rejected: 1, total: 10, rate: 90.0 }],
      error: null,
    })
    const { result } = renderHook(() => useApprovalRate())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.approved).toBe(9)
    expect(result.current.rejected).toBe(1)
    expect(result.current.total).toBe(10)
    expect(result.current.rate).toBe(90.0)
    expect(result.current.error).toBeNull()
  })

  it('returns null rate and zero counts when no completions exist', async () => {
    mockRpc.mockResolvedValue({
      data: [{ approved: 0, rejected: 0, total: 0, rate: null }],
      error: null,
    })
    const { result } = renderHook(() => useApprovalRate())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.total).toBe(0)
    expect(result.current.rate).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('handles empty data array gracefully', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    const { result } = renderHook(() => useApprovalRate())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.approved).toBe(0)
    expect(result.current.total).toBe(0)
    expect(result.current.rate).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('sets error when RPC fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const { result } = renderHook(() => useApprovalRate())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
    expect(result.current.total).toBe(0)
  })

  it('calls get_my_approval_rate RPC', async () => {
    mockRpc.mockResolvedValue({
      data: [{ approved: 5, rejected: 0, total: 5, rate: 100.0 }],
      error: null,
    })
    renderHook(() => useApprovalRate())
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('get_my_approval_rate'))
  })
})
