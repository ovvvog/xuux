// مدخل جذر الثقة. مسارات الاستيراد تبقى `.mjs` لأن كل وحدة `.mts` تُصرَّف
// إلى ملف `.mjs` مجاور لها في M2.01، فلا يتغير شيء عند المستهلكين.

export * from './identity.mjs';
export * from './event-log.mjs';
export * from './crown.mjs';
export * from './policy.mjs';
export * from './persistent-log.mjs';
export * from './anchor.mjs';

// قيدُ التركيبِ عند نقطةِ الإقلاعِ الإنتاجيّة (WL-089): يُصدَّر قبل وحداتِ
// المفاتيح لأن كلَّ مَن يبني موفّراً أو هويةً يمرُّ عليه.
export * from './production-boot.mjs';

export * from './key-store.mjs';
export * from './key-provider.mjs';
export * from './key-provider-local.mjs';
export * from './key-provider-remote.mjs';
export * from './king-key.mjs';
export * from './king-key-rotation.mjs';
export * from './command-ledger.mjs';
export * from './hsm-binding.mjs';
export * from './halt-switch.mjs';
export * from './clock.mjs';

// المصنعُ الإنتاجيُّ (WL-092): يُصدَّرُ بعدَ كلِّ ما يبنيه، فهو مستهلكُها جميعاً.
export * from './production-runtime.mjs';
