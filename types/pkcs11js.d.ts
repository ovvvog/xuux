// Stub تعريفي لـ pkcs11js على منصّات لا تُثبّت فيها الوحدة native.
//
// pkcs11js وحدة native تحتاج Visual Studio Build Tools على Windows.
// عند غيابها، npm ci يتخطّاها (optionalDependencies)، فيغيب نوعها عن TypeScript.
// هذا الـ stub يُعلن الوحدة كـ any فيُتيح typecheck على Windows.
//
// عند تثبيت pkcs11js فعليًا (Linux أو Windows بأدوات بناء)، TypeScript يستخدم
// الأنواع الحقيقية من node_modules ويتجاهل هذا الـ stub.

declare module 'pkcs11js';
