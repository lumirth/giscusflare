import {messages} from './upstream-messages.js';
import { upstreamLocales } from './upstream-locales.js';
const en = {
  reason:'Reason',reasonOffTopic:'Off-topic',reasonAbuse:'Abuse',reasonDuplicate:'Duplicate',reasonOutdated:'Outdated',reasonResolved:'Resolved',reasonSpam:'Spam',
  loadingReplies: 'Loading previous replies…',
  discussionUnavailable: 'This discussion was deleted or is no longer available.',
  discussionActions: 'Discussion actions',
  writeReply: 'Write a reply…', answered: 'Answer',
  deletedAuthor: '[deleted]', deletedComment: 'This comment was deleted.',
  actions: 'Comment actions', reportOnGitHub: 'Report on GitHub ↗',
  comments: "Comments",
  signIn: "Sign in with GitHub",
  signOut: "Sign out",
  oldest: "Oldest first",
  newest: "Newest first",
  loading: "Loading comments...",
  write: "Write",
  preview: "Preview",
  post: "Post comment",
  reply: "Reply",
  edit: "Edit",
  remove: "Delete",
  save: "Save changes",
  cancel: "Cancel",
  more: "Load more comments",
  placeholder: "Write a comment",
  markdown: "Markdown guide",
  locked: "This discussion is locked.",
  archived: "This repository is archived.",
  hidden: "Hidden comment",
  hide: "Hide comment",
  unhide: "Show comment",
  onGitHub: "View on GitHub",
  deleteConfirm: "Delete this comment? This cannot be undone.",
  edited: "Edited",
  reactions: "Add a reaction",
  retry: "Retry",
  commentOrder: "Comment order",
  editorMode: "Editor mode",
  thumbsUp: "Thumbs up",
  thumbsDown: "Thumbs down",
  laugh: "Laugh",
  hooray: "Hooray",
  confused: "Confused",
  heart: "Heart",
  rocket: "Rocket",
  eyes: "Eyes",
};
export type Strings = typeof en;
const dictionaries: Record<string, Partial<Strings>> = {
  es: {
    comments: "Comentarios",
    edit: "Editar",
    remove: "Eliminar",
    save: "Guardar cambios",
    hidden: "Comentario oculto",
    hide: "Ocultar por estar fuera de tema",
    unhide: "Mostrar",
    onGitHub: "Ver en GitHub",
    retry: "Reintentar",
    deleteConfirm: "¿Eliminar este comentario? No se puede deshacer.",
    commentOrder: "Orden de los comentarios",
    editorMode: "Modo del editor",
  },
  fr: {
    comments: "Commentaires",
    edit: "Modifier",
    remove: "Supprimer",
    save: "Enregistrer",
    hidden: "Commentaire masqué",
    hide: "Masquer comme hors sujet",
    unhide: "Afficher",
    onGitHub: "Voir sur GitHub",
    retry: "Réessayer",
    deleteConfirm: "Supprimer ce commentaire ? Cette action est irréversible.",
    commentOrder: "Ordre des commentaires",
    editorMode: "Mode de rédaction",
  },
  de: {
    comments: "Kommentare",
    edit: "Bearbeiten",
    remove: "Löschen",
    save: "Änderungen speichern",
    hidden: "Ausgeblendeter Kommentar",
    hide: "Als themenfremd ausblenden",
    unhide: "Einblenden",
    onGitHub: "Auf GitHub ansehen",
    retry: "Erneut versuchen",
    deleteConfirm: "Diesen Kommentar löschen? Das lässt sich nicht rückgängig machen.",
    commentOrder: "Reihenfolge der Kommentare",
    editorMode: "Bearbeitungsmodus",
  },
  pl: {
    comments: "Komentarze",
    edit: "Edytuj",
    remove: "Usuń",
    save: "Zapisz zmiany",
    hidden: "Ukryty komentarz",
    hide: "Ukryj jako nie na temat",
    unhide: "Pokaż",
    onGitHub: "Zobacz na GitHub",
    retry: "Spróbuj ponownie",
    deleteConfirm: "Usunąć ten komentarz? Tej czynności nie można cofnąć.",
    commentOrder: "Kolejność komentarzy",
    editorMode: "Tryb edytora",
  },
  pt: {
    comments: "Comentários",
    edit: "Editar",
    remove: "Excluir",
    save: "Salvar alterações",
    hidden: "Comentário oculto",
    onGitHub: "Ver no GitHub",
    retry: "Tentar novamente",
    deleteConfirm: "Excluir este comentário? Esta ação não pode ser desfeita.",
    commentOrder: "Ordem dos comentários",
    editorMode: "Modo do editor",
  },
  ja: {
    comments: "コメント",
    edit: "編集",
    remove: "削除",
    save: "変更を保存",
    hidden: "非表示のコメント",
    onGitHub: "GitHubで見る",
    retry: "再試行",
    deleteConfirm: "このコメントを削除しますか？元には戻せません。",
    commentOrder: "コメントの順序",
    editorMode: "編集モード",
  },
  ko: {
    comments: "댓글",
    edit: "수정",
    remove: "삭제",
    save: "변경 사항 저장",
    hidden: "숨겨진 댓글",
    onGitHub: "GitHub에서 보기",
    retry: "다시 시도",
    deleteConfirm: "이 댓글을 삭제하시겠습니까? 되돌릴 수 없습니다.",
    commentOrder: "댓글 정렬",
    editorMode: "편집 모드",
  },
  zh: {
    comments: "评论",
    signIn: "使用 GitHub 登录",
    signOut: "退出登录",
    oldest: "最早优先",
    newest: "最新优先",
    loading: "正在加载评论...",
    write: "编写",
    preview: "预览",
    post: "发表评论",
    reply: "回复",
    edit: "编辑",
    remove: "删除",
    save: "保存更改",
    cancel: "取消",
    more: "加载更多评论",
    placeholder: "输入评论",
    hidden: "已隐藏的评论",
    onGitHub: "在 GitHub 上查看",
    edited: "已编辑",
    retry: "重试",
    markdown: "Markdown 指南",
    deleteConfirm: "删除这条评论？此操作无法撤销。",
    reactions: "添加表情回应",
    commentOrder: "评论排序",
    editorMode: "编辑模式",
    thumbsUp: "拇指向上",
    thumbsDown: "拇指向下",
    laugh: "大笑",
    hooray: "庆祝",
    confused: "困惑",
    heart: "爱心",
    rocket: "火箭",
    eyes: "眼睛",
  },
  ar: {
    comments: "التعليقات",
    edit: "تعديل",
    remove: "حذف",
    save: "حفظ التغييرات",
    hidden: "تعليق مخفي",
    onGitHub: "عرض على GitHub",
    retry: "إعادة المحاولة",
    deleteConfirm: "هل تريد حذف هذا التعليق؟ لا يمكن التراجع عن هذا الإجراء.",
    commentOrder: "ترتيب التعليقات",
    editorMode: "وضع المحرر",
  },
};
// One catalog per supported locale; regional forms inherit their complete base.
const catalogs = new Map<string, Readonly<Strings>>(
  [...new Set([...Object.keys(upstreamLocales), ...Object.keys(dictionaries)])].map(lang => {
    const base = lang.split('-')[0]!;
    return [lang, Object.freeze({ ...en, ...upstreamLocales[base], ...dictionaries[base], ...upstreamLocales[lang] })] as const;
  }),
);
export function strings(lang: string): Readonly<Strings> {
  return catalogs.get(lang) ?? catalogs.get(lang.split('-')[0]!) ?? catalogs.get('en')!;
}

const reactionNames: Record<string, keyof Strings> = {
  THUMBS_UP: 'thumbsUp', THUMBS_DOWN: 'thumbsDown', LAUGH: 'laugh', HOORAY: 'hooray',
  CONFUSED: 'confused', HEART: 'heart', ROCKET: 'rocket', EYES: 'eyes',
};
export function reactionLabel(text: Strings, reaction: string): string {
  const key = Object.hasOwn(reactionNames, reaction) ? reactionNames[reaction] : undefined;
  return key ? text[key] : reaction;
}


export function message(lang:string,key:string,count?:number,plus=''):string {
  const entry=messages[lang]?.[key]??messages.en?.[key]??key;
  if(typeof entry==='string')return entry;
  const quantity=count??0;let category='other';try{category=new Intl.PluralRules(lang).select(quantity);}catch{/* English fallback. */}
  return (entry[String(quantity)]??entry[category]??entry.other??key).replaceAll('{{count}}',String(quantity)).replaceAll('{{plus}}',plus);
}
export function relativeDate(date:Date,lang:string,now=new Date()):string {
  const seconds=Math.max(0,Math.floor((now.getTime()-date.getTime())/1000));
  const locale=Intl.DateTimeFormat.supportedLocalesOf([lang]).length?lang:'en';
  if(date.getUTCFullYear()<now.getUTCFullYear()||seconds>=30*86400)return date.toLocaleDateString(locale,{month:'short',day:'numeric',...(date.getUTCFullYear()<now.getUTCFullYear()?{year:'numeric' as const}:{})});
  const unit=seconds>=86400?'day':seconds>=3600?'hour':seconds>=60?'minute':'second';
  const divisor=unit==='day'?86400:unit==='hour'?3600:unit==='minute'?60:1;
  return new Intl.RelativeTimeFormat(locale,{numeric:'always'}).format(-Math.floor(seconds/divisor),unit);
}
