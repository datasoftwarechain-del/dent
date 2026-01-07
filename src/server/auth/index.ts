export * from './permissions';

export const getUser = (astro: { locals: App.Locals }) => astro.locals.user;
