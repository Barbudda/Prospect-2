// Pappers API — French company registry (SIRENE / RCS)
// Provides SIRET, SIREN, activity code (NAF), address, legal form.
// Raw data only — Mammouth resolves the best entity match.
//
// Config env var: PAPPERS_API_KEY

const PAPPERS_BASE = "https://api.pappers.fr/v2";

export interface PappersCompany {
  siren: string;
  siret_siege?: string;
  nom_entreprise?: string;
  denomination?: string;
  forme_juridique?: string;
  code_naf?: string;
  libelle_code_naf?: string;
  adresse_siege?: string;
  ville_siege?: string;
  code_postal_siege?: string;
  date_creation?: string;
  statut?: string;
  site_web?: string;
  dirigeants?: Array<{ nom?: string; prenom?: string; qualite?: string }>;
  score?: number;
}

export function isConfigured(): boolean {
  return Boolean(process.env.PAPPERS_API_KEY);
}

export async function searchCompany(
  query: string,
  departement?: string
): Promise<PappersCompany[]> {
  const key = process.env.PAPPERS_API_KEY;
  if (!key) throw new Error("PAPPERS_API_KEY not configured");

  const params = new URLSearchParams({
    api_token: key,
    q: query.slice(0, 100),
    precision: "standard",
    par_page: "10",
  });

  if (departement) params.set("departement", departement);

  const res = await fetch(`${PAPPERS_BASE}/recherche?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Pappers HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const data = await res.json() as {
    resultats?: Array<{
      siren?: string;
      siret_siege?: string;
      nom_entreprise?: string;
      denomination?: string;
      forme_juridique?: string;
      code_naf?: string;
      libelle_code_naf?: string;
      siege?: {
        adresse_ligne_1?: string;
        ville?: string;
        code_postal?: string;
      };
      date_creation?: string;
      statut?: string;
      sites_web?: string[];
      representants?: Array<{ nom?: string; prenom?: string; qualite?: string }>;
      score?: number;
    }>;
  };

  return (data.resultats ?? []).map((r) => ({
    siren: r.siren ?? "",
    siret_siege: r.siret_siege,
    nom_entreprise: r.nom_entreprise,
    denomination: r.denomination,
    forme_juridique: r.forme_juridique,
    code_naf: r.code_naf,
    libelle_code_naf: r.libelle_code_naf,
    adresse_siege: r.siege?.adresse_ligne_1,
    ville_siege: r.siege?.ville,
    code_postal_siege: r.siege?.code_postal,
    date_creation: r.date_creation,
    statut: r.statut,
    site_web: r.sites_web?.[0],
    dirigeants: (r.representants ?? []).map((d) => ({
      nom: d.nom,
      prenom: d.prenom,
      qualite: d.qualite,
    })),
    score: r.score,
  }));
}

export async function getCompanyBySiret(siret: string): Promise<PappersCompany | null> {
  const key = process.env.PAPPERS_API_KEY;
  if (!key) throw new Error("PAPPERS_API_KEY not configured");

  const params = new URLSearchParams({
    api_token: key,
    siret,
  });

  const res = await fetch(`${PAPPERS_BASE}/entreprise?${params}`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return null;

  const r = await res.json() as {
    siren?: string;
    siret_siege?: string;
    nom_entreprise?: string;
    denomination?: string;
    forme_juridique?: string;
    code_naf?: string;
    libelle_code_naf?: string;
    siege?: { adresse_ligne_1?: string; ville?: string; code_postal?: string };
    date_creation?: string;
    statut?: string;
    sites_web?: string[];
    representants?: Array<{ nom?: string; prenom?: string; qualite?: string }>;
  };

  if (!r.siren) return null;

  return {
    siren: r.siren,
    siret_siege: r.siret_siege,
    nom_entreprise: r.nom_entreprise,
    denomination: r.denomination,
    forme_juridique: r.forme_juridique,
    code_naf: r.code_naf,
    libelle_code_naf: r.libelle_code_naf,
    adresse_siege: r.siege?.adresse_ligne_1,
    ville_siege: r.siege?.ville,
    code_postal_siege: r.siege?.code_postal,
    date_creation: r.date_creation,
    statut: r.statut,
    site_web: r.sites_web?.[0],
    dirigeants: (r.representants ?? []).map((d) => ({
      nom: d.nom,
      prenom: d.prenom,
      qualite: d.qualite,
    })),
  };
}
