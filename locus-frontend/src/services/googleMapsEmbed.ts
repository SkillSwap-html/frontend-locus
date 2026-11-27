function limparChave(valor: unknown): string {
  return String(valor ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\([:/])/g, "$1");
}

export function chaveGoogleMapsEmbed(): string {
  return limparChave(
    import.meta.env["VITE_GOOGLE_MAPS_EMBED_API_KEY"]
      || import.meta.env["VITE_GOOGLE_MAPS_API_KEY"],
  );
}

export function urlGoogleMapsEmbed(
  modo: "place" | "view" | "streetview",
  parametros: Record<string, string>,
): string {
  const chave = chaveGoogleMapsEmbed();
  const busca = new URLSearchParams({ key: chave, ...parametros });
  return `https://www.google.com/maps/embed/v1/${modo}?${busca.toString()}`;
}
