import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import type { FamilyAliasProposal, FamilyAliasVote } from '../../types/database'

function formatCountdown(expiresAt: string): string {
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (diffMs <= 0) return 'הסתיים'
  const totalSeconds = Math.floor(diffMs / 1000)
  const minutes      = Math.floor(totalSeconds / 60)
  const seconds      = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

interface AliasVoteBannerProps {
  proposal: FamilyAliasProposal
  votes: FamilyAliasVote[]
  totalMembers: number
  currentUserId: string
  castVote: (vote: boolean) => Promise<void>
}

export default function AliasVoteBanner({
  proposal,
  votes,
  totalMembers,
  currentUserId,
  castVote,
}: AliasVoteBannerProps) {
  const [countdown, setCountdown] = useState(() => formatCountdown(proposal.expires_at))
  const [voting, setVoting]       = useState(false)
  const [voteError, setVoteError] = useState<string | null>(null)

  useEffect(() => {
    const interval = setInterval(
      () => setCountdown(formatCountdown(proposal.expires_at)),
      1000
    )
    return () => clearInterval(interval)
  }, [proposal.expires_at])

  const yesVotes = votes.filter(v => v.vote).length
  const noVotes  = votes.filter(v => !v.vote).length
  const notVoted = totalMembers - votes.length
  const myVote   = votes.find(v => v.user_id === currentUserId)

  async function handleVote(vote: boolean) {
    setVoting(true)
    setVoteError(null)
    try {
      await castVote(vote)
    } catch (err) {
      setVoteError((err as Error).message)
    } finally {
      setVoting(false)
    }
  }

  return (
    <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 space-y-2 mb-4">
      <p className="text-sm font-medium">
        הצעה לכינוי חדש:{' '}
        <span className="text-primary">"{proposal.proposed_alias}"</span>
      </p>
      <p className="text-xs text-muted-foreground">
        תומכים: {yesVotes} | מתנגדים: {noVotes} | לא הצביעו: {notVoted}
      </p>
      <p className="text-xs text-muted-foreground">נותרו: {countdown}</p>

      {myVote ? (
        <p className="text-xs text-muted-foreground">הצבעת: {myVote.vote ? 'כן' : 'לא'}</p>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" disabled={voting} onClick={() => handleVote(true)}>כן</Button>
          <Button size="sm" variant="outline" disabled={voting} onClick={() => handleVote(false)}>לא</Button>
        </div>
      )}
      {voteError && <p role="alert" className="text-xs text-destructive">{voteError}</p>}
    </div>
  )
}
