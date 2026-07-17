"""Agent memory: what an agent knows about a specific opponent.

Derived from resolved battle history. The (wins, losses) pair is embedded
in every battle log's inputs block, keeping replays reproducible even
though memory changes over time.
"""

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Battle


async def head_to_head(
    db: AsyncSession, agent_id: int, opponent_id: int
) -> tuple[int, int]:
    """Returns (wins, losses) for agent_id vs opponent_id."""
    q = select(Battle.winner_agent).where(
        Battle.status == "resolved",
        or_(
            and_(Battle.agent_a == agent_id, Battle.agent_b == opponent_id),
            and_(Battle.agent_a == opponent_id, Battle.agent_b == agent_id),
        ),
    )
    winners = (await db.execute(q)).scalars().all()
    wins = sum(1 for w in winners if w == agent_id)
    return wins, len(winners) - wins
