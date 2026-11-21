type GoogleMapsNamespace = {
  maps: {
    Map: new (element: HTMLElement, options: Record<string, unknown>) => unknown;
    Marker: new (options: Record<string, unknown>) => unknown;
    LatLngBounds: new () => { extend(point: { lat: number; lng: number }): void };
    StreetViewPanorama: new (element: HTMLElement, options: Record<string, unknown>) => {
      addListener(event: string, callback: () => void): { remove(): void };
      getStatus?: () => string;
    };
    StreetViewService: new () => {
      getPanorama(
        request: Record<string, unknown>,
        callback: (data: { location?: { latLng?: { lat: number; lng: number } } } | null, status: string) => void,
      ): void;
    };
    StreetViewStatus?: { OK?: string };
  };
};

let carregamento: Promise<GoogleMapsNamespace> | null = null;

export function carregarGoogleMaps(): Promise<GoogleMapsNamespace> {
  const chave = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\([:/])/g, "$1");
  if (!chave) {
    return Promise.reject(new Error("Configure a chave do Google Maps JavaScript API no frontend."));
  }

  const existente = (window as Window & { google?: GoogleMapsNamespace }).google;
  if (existente?.maps) return Promise.resolve(existente);
  if (carregamento) return carregamento;

  carregamento = new Promise((resolve, reject) => {
    const janela = window as Window & {
      google?: GoogleMapsNamespace;
      gm_authFailure?: () => void;
    };
    janela.gm_authFailure = () => reject(new Error("A chave do Google Maps não está autorizada para este domínio ou API."));
    const anterior = document.getElementById("locus-google-maps-script") as HTMLScriptElement | null;
    if (anterior) {
      anterior.addEventListener("load", () => {
        const google = janela.google;
        google ? resolve(google) : reject(new Error("O Google Maps não ficou disponível."));
      }, { once: true });
      anterior.addEventListener("error", () => reject(new Error("Não foi possível carregar o Google Maps.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "locus-google-maps-script";
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(chave)}&v=weekly&libraries=marker`;
    script.onload = () => {
      const google = janela.google;
      google ? resolve(google) : reject(new Error("O Google Maps não ficou disponível."));
    };
    script.onerror = () => reject(new Error("A chave do Google Maps não está autorizada para este domínio."));
    document.head.appendChild(script);
  }).catch((error) => {
    carregamento = null;
    throw error;
  });

  return carregamento;
}
