from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.payment import UserEntitlement


async def get_user_entitlement(db: AsyncSession, user_id: int) -> Optional[UserEntitlement]:
    result = await db.execute(select(UserEntitlement).where(UserEntitlement.user_id == user_id))
    return result.scalar_one_or_none()


async def has_active_pro_access(db: AsyncSession, user_id: int) -> bool:
    entitlement = await get_user_entitlement(db, user_id)
    if not entitlement or not entitlement.pro_expires_at:
        return False
    return entitlement.pro_expires_at >= datetime.utcnow()
