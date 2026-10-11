// Та же картинка для twitter:image. revalidate объявлен здесь литералом: Next
// читает настройки маршрута только из самого файла, реэкспорт он не видит.
export { default, alt, size, contentType } from "./opengraph-image";
export const revalidate = 3600;
