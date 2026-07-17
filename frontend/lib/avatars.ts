/**
 * Avatar registry. Every skin item id maps to an image under /avatars/.
 *
 * ADDING YOUR OWN AVATARS:
 * 1. Drop any image (svg/png/jpg, square works best) into public/avatars/
 * 2. Add a line here: my_hero: { src: '/avatars/my_hero.png', name: 'My Hero' }
 * 3. (optional) Make it earnable/buyable: add a matching skin ItemDef with the
 *    same id in backend/app/market/catalog.py, and/or price it on the Shop
 *    contract for BOT purchases. Without a catalog entry it's a free default.
 */

export interface AvatarDef {
  src: string;
  name: string;
}

export const AVATARS: Record<string, AvatarDef> = {
  av_ronin: { src: '/avatars/av_ronin.svg', name: 'Ronin' },
  av_guardian: { src: '/avatars/av_guardian.svg', name: 'Guardian' },
  av_striker: { src: '/avatars/av_striker.svg', name: 'Striker' },
  av_mystic: { src: '/avatars/av_mystic.svg', name: 'Mystic' },
  av_captain: { src: '/avatars/av_captain.svg', name: 'Captain' },
  av_shadow: { src: '/avatars/av_shadow.svg', name: 'Shadow' },
  av_valkyrie: { src: '/avatars/av_valkyrie.svg', name: 'Valkyrie' },
  av_monk: { src: '/avatars/av_monk.svg', name: 'Monk' },
  av_cyber: { src: '/avatars/av_cyber.svg', name: 'Cyber Duelist' },
  av_champion: { src: '/avatars/av_champion.svg', name: 'Champion' },
};
