/* E.J. Desk — configuração do Supabase.
   Onde achar (veja o Passo 6 do guia): botão "Connect" no topo do projeto, ou
   Project Settings › API Keys (chave) e Project Settings › Data API (endereço).
     • Project URL (https://xxxx.supabase.co)                 → supabaseUrl
     • Publishable key (sb_publishable_…) ou anon key (eyJ…)  → supabaseAnonKey
   Essa chave é pública e pode ficar aqui: quem protege os dados são as regras do banco (RLS).
   NUNCA coloque aqui a Secret key (sb_secret_…) nem a service_role. */
window.EJD_CONFIG = {
  supabaseUrl: "https://erukkcqmsuksgnbevoty.supabase.co",
  supabaseAnonKey: "sb_publishable_5jj8bLGm7GUu4voN1w-rUg_WoEI1u-w"
};
