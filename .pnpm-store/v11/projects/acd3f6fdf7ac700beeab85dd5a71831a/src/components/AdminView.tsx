import { useEffect, useState } from "react";
import { Activity, Clock3, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { adicionarAdministrador, alterarTipoUsuario, listarAdministradores, listarUsuariosAdmin, removerAdministrador, type AdminEmail, type UsuarioAdmin } from "@/services/admin";

const tipos = ["VIAJANTE", "ADMINISTRADOR", "CURADOR_CONTEUDO", "RESPONSAVEL_TECNICO"];

export function AdminView({ onToast }: { onToast: (value: string) => void }) {
  const [admins, setAdmins] = useState<AdminEmail[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [email, setEmail] = useState("");
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    try {
      const [listaAdmins, listaUsuarios] = await Promise.all([listarAdministradores(), listarUsuariosAdmin()]);
      setAdmins(listaAdmins);
      setUsuarios(listaUsuarios);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Não foi possível carregar a administração.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { void carregar(); }, []);

  async function adicionar() {
    if (!email.trim()) return;
    try {
      await adicionarAdministrador(email.trim());
      setEmail("");
      onToast("Administrador autorizado. Se ainda não tiver conta, será reconhecido no primeiro login.");
      await carregar();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Não foi possível adicionar este administrador.");
    }
  }

  async function remover(item: AdminEmail) {
    if (!window.confirm(`Remover ${item.email} da administração?`)) return;
    try {
      await removerAdministrador(item.email);
      onToast("Administrador removido.");
      await carregar();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Não foi possível remover este administrador.");
    }
  }

  async function mudarTipo(usuario: UsuarioAdmin, tipoUsuario: string) {
    try {
      const atualizado = await alterarTipoUsuario(usuario.id, tipoUsuario);
      setUsuarios((atuais) => atuais.map((item) => item.id === atualizado.id ? atualizado : item));
      onToast("Permissão atualizada.");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Não foi possível atualizar a permissão.");
    }
  }

  const contasPendentes = admins.filter((item) => !item.contaEncontrada).length;
  const administradoresAtivos = usuarios.filter((item) => item.tipoUsuario === "ADMINISTRADOR").length;

  return (
    <section className="view-stack">
      <div className="form-hero admin-hero">
        <div><p className="eyebrow">Gestão da plataforma</p><h1>Painel de administração</h1><p className="view-subtitle">Acompanhe a base e gerencie os acessos do Locus.</p></div>
        <div className="assistant-heading-mark"><ShieldCheck size={28} /></div>
      </div>
      <div className="admin-metrics">
        <div className="admin-metric"><Users size={19} /><span>Usuários cadastrados</span><strong>{usuarios.length}</strong></div>
        <div className="admin-metric"><ShieldCheck size={19} /><span>Administradores ativos</span><strong>{administradoresAtivos}</strong></div>
        <div className="admin-metric"><Clock3 size={19} /><span>Convites pendentes</span><strong>{contasPendentes}</strong></div>
        <div className="admin-metric"><Activity size={19} /><span>Status do painel</span><strong>{carregando ? "..." : "Ativo"}</strong></div>
      </div>
      <div className="admin-grid">
        <div className="surface-panel admin-panel">
          <div className="section-heading"><div><span className="section-label">Acesso</span><h2>Administradores autorizados</h2></div><ShieldCheck size={20} /></div>
          <div className="admin-add"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@exemplo.com" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void adicionar(); } }} /><button className="primary-button" onClick={() => void adicionar()}><UserPlus size={16} /> Adicionar</button></div>
          <p className="field-hint">O e-mail pode ser incluído antes do cadastro. Quando a pessoa entrar com o Google, o acesso será reconhecido automaticamente.</p>
          {carregando ? <div className="inline-loading">Carregando...</div> : <div className="admin-list">{admins.map((item) => <div className="admin-row" key={item.email}><div><strong>{item.email}</strong><small>{item.contaEncontrada ? item.nome || "Conta cadastrada" : "Aguardando cadastro"}</small></div><button className="icon-button danger-icon" onClick={() => void remover(item)} aria-label={`Remover ${item.email}`}><Trash2 size={16} /></button></div>)}</div>}
        </div>
        <div className="surface-panel admin-panel">
          <div className="section-heading"><div><span className="section-label">Usuários</span><h2>Permissões da plataforma</h2></div><span className="count-pill">{usuarios.length}</span></div>
          <div className="admin-list">{usuarios.map((usuario) => <div className="admin-row" key={usuario.id}><div><strong>{usuario.nome}</strong><small>{usuario.email}</small></div><select value={usuario.tipoUsuario} onChange={(event) => void mudarTipo(usuario, event.target.value)} aria-label={`Permissão de ${usuario.email}`}>{tipos.map((tipo) => <option key={tipo} value={tipo}>{tipo.replaceAll("_", " ")}</option>)}</select></div>)}</div>
        </div>
      </div>
    </section>
  );
}
