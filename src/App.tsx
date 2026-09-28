import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  createId,
  createNextMonthEntry,
  formatCompactNumber,
  formatCurrency,
  getEstimate,
  getMonthNames,
  getSavedAmount,
  newGoalTemplate,
  percentOf,
  type Goal,
} from './data/goalsStore';
import { createGoalInApi, deleteGoalFromApi, leaveGoalFromApi, listGoalsFromApi } from './data/apiGoalsStore';
import {
  applyThemeTokens,
  loadAppSettings,
  paletteOptions,
  resolveThemeTokens,
  saveAppSettings,
  type AppSettings,
} from './data/appSettingsStore';
import { getCurrentUser, loginUser, logoutUser, registerUser, subscribeToAuth, translateAuthError, updateProfile } from './data/authStore';
import type { ApiUser } from './data/apiClient';
import { deleteInvitation, listAcceptedUsers, listInvitations, listRegisteredUsers, sendInvitation, subscribeToInvitations, updateInvitationStatus, type SharedInvitation } from './data/sharedAccountStore';

function useGoalsData() {
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    listGoalsFromApi().then(setGoals).catch(() => undefined);
  }, []);

  const refresh = () => {
    void listGoalsFromApi().then(setGoals);
  };

  const saveGoal = async (goal: Goal, memberUsernames: string[] = []) => {
    if (!Number.isNaN(Number(goal.id))) {
      setGoals((currentGoals) => currentGoals.map((currentGoal) => currentGoal.id === goal.id ? goal : currentGoal));
      return goal;
    }

    const savedGoal = await createGoalInApi(goal, memberUsernames);
    setGoals((currentGoals) => [savedGoal, ...currentGoals]);
    return savedGoal;
  };

  const deleteGoal = async (goalId: string) => {
    await deleteGoalFromApi(goalId);
    setGoals((currentGoals) => currentGoals.filter((goal) => goal.id !== goalId));
  };

  const leaveGoal = async (goalId: string) => {
    await leaveGoalFromApi(goalId);
    setGoals((currentGoals) => currentGoals.filter((goal) => goal.id !== goalId));
  };

  const patchGoal = (goalId: string, updater: (goal: Goal) => Goal) => {
    setGoals((currentGoals) => currentGoals.map((currentGoal) => currentGoal.id === goalId ? updater(currentGoal) : currentGoal));
  };

  return { goals, refresh, saveGoal, deleteGoal, leaveGoal, patchGoal };
}

function App() {
  const goalsApi = useGoalsData();
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [user, setUser] = useState<ApiUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => subscribeToAuth((nextUser) => {
    setUser(nextUser);
    setAuthLoading(false);
  }), []);

  useEffect(() => {
    saveAppSettings(settings);
    applyThemeTokens(resolveThemeTokens(settings), settings.themeMode);
  }, [settings]);

  if (authLoading) {
    return <div className="auth-loading">Cargando AhorraYa...</div>;
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <Routes>
      <Route path="/" element={<OverviewPage goals={goalsApi.goals} settings={settings} user={user} />} />
      <Route path="/goals/new" element={<GoalEditorPage goalsApi={goalsApi} user={user} />} />
      <Route path="/goals/:goalId" element={<GoalDetailPage goalsApi={goalsApi} />} />
      <Route path="/goals/:goalId/edit" element={<GoalEditorPage goalsApi={goalsApi} user={user} />} />
      <Route path="/shared" element={<SharedAccountPage userId={user.id} user={user} />} />
      <Route path="/profile" element={<ProfilePage user={user} />} />
      <Route
        path="/settings"
        element={<SettingsPage settings={settings} onChangeSettings={setSettings} />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AuthPage() {
  const [darkMode, setDarkMode] = useState(() => document.documentElement.dataset.theme === 'dark');
  const [registerMode, setRegisterMode] = useState(false);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    applyThemeTokens(resolveThemeTokens({ themeMode: darkMode ? 'dark' : 'light', palette: 'teal' }), darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setBusy(true);

    try {
      if (registerMode) {
        await registerUser(email, password, username, fullName);
      } else {
        await loginUser(email, password);
      }
    } catch (authError) {
      setError(translateAuthError(authError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-panel panel">
        <button
          type="button"
          className="auth-theme-toggle"
          onClick={() => setDarkMode((currentMode) => !currentMode)}
          aria-label={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          {darkMode ? '☀' : '☾'}
        </button>
        <p className="eyebrow">AhorraYa</p>
        <h1>{registerMode ? 'Crear cuenta' : 'Iniciar sesión'}</h1>
        <p className="auth-copy">Usa tu cuenta para crear metas y aceptar invitaciones desde cualquier dispositivo.</p>
        <form className="auth-form" onSubmit={submit}>
          {registerMode && <input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Nombre completo" />}
          {registerMode && <input required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Usuario (ej. isi.demo)" />}
          <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Correo electrónico" />
          <input required type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contraseña" />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Procesando...' : registerMode ? 'Registrarme' : 'Entrar'}</button>
        </form>
        <button className="link-button" onClick={() => { setRegisterMode(!registerMode); setError(''); }}>
          {registerMode ? 'Ya tengo una cuenta' : 'Crear una cuenta nueva'}
        </button>
      </section>
    </main>
  );
}

function OverviewPage({ goals, settings, user }: { goals: Goal[]; settings: AppSettings; user: ApiUser }) {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<'personal' | 'shared'>('personal');
  const personalGoals = goals.filter((goal) => !goal.shared);
  const sharedGoals = goals.filter((goal) => goal.shared);

  const renderGoal = (goal: Goal) => {
    const monthlyTotal = goal.contributors.reduce((sum, contributor) => sum + contributor.monthlyAmount, 0);
    const savedAmount = getSavedAmount(goal);
    const progress = percentOf(goal.goalAmount, savedAmount);
    const estimate = getEstimate(savedAmount, goal.goalAmount, monthlyTotal);

    return (
      <button className="goal-card" key={goal.id} onClick={() => navigate(`/goals/${goal.id}`)}>
        <div className="mini-ring" style={{ background: `conic-gradient(var(--gold) ${progress}%, var(--ring) 0)` }}><span>{progress}%</span></div>
        <div className="goal-card-copy">
          <div className="goal-meta"><span>{goal.shared ? 'Compartida' : 'Personal'}</span><strong>{estimate ? `${estimate.month} ${estimate.year}` : 'Sin cálculo'}</strong></div>
          <h2>{goal.name}</h2>
          <p>{formatCurrency(savedAmount)} / {formatCurrency(goal.goalAmount)}</p>
        </div>
      </button>
    );
  };

  const visibleGoals = activeCategory === 'personal' ? personalGoals : sharedGoals;
  const visibleTitle = activeCategory === 'personal' ? 'Personales' : 'Compartidas';

  return (
    <div className="app-shell overview-shell">
      <header className="hero-header">
        <div>
          <p className="brand-mark">Tus metas de ahorro</p>
          <p className="header-chip">{user.fullName || user.email}</p>
        </div>
      </header>

      <main className="content-stack overview-stack">
        <section className="overview-cta">
          <button className="primary-button" onClick={() => navigate('/goals/new')}>
            Crear meta
          </button>
        </section>
        <div className="goal-tabs" role="tablist" aria-label="Tipo de metas">
          <button
            className={activeCategory === 'personal' ? 'goal-tab active' : 'goal-tab'}
            role="tab"
            aria-selected={activeCategory === 'personal'}
            onClick={() => setActiveCategory('personal')}
          >
            Personales
          </button>
          <button
            className={activeCategory === 'shared' ? 'goal-tab active' : 'goal-tab'}
            role="tab"
            aria-selected={activeCategory === 'shared'}
            onClick={() => setActiveCategory('shared')}
          >
            Compartidas
          </button>
        </div>
        <section className="goal-section">
          <div className="section-heading"><div><p className="eyebrow">Metas</p><h2>{visibleTitle}</h2></div></div>
          <div className="panel overview-panel">
            {visibleGoals.length > 0 ? visibleGoals.map(renderGoal) : <p className="section-empty">Aún no tienes metas {visibleTitle.toLowerCase()}.</p>}
          </div>
        </section>
      </main>
      <QuickNav active="home" />
    </div>
  );
}

function QuickNav({ active }: { active: 'home' | 'invitations' | 'profile' | 'settings' }) {
  const navigate = useNavigate();

  return (
    <nav className="quick-nav" aria-label="Accesos rápidos">
      <button className={active === 'invitations' ? 'quick-nav-item active' : 'quick-nav-item'} onClick={() => navigate('/shared')}>
        <span aria-hidden="true">✉</span>
        <strong>Invitaciones</strong>
      </button>
      <button className={active === 'home' ? 'quick-nav-item active home' : 'quick-nav-item home'} onClick={() => navigate('/')}>
        <span aria-hidden="true">⌂</span>
        <strong>Inicio</strong>
      </button>
      <button className={active === 'profile' ? 'quick-nav-item active' : 'quick-nav-item'} onClick={() => navigate('/profile')}>
        <span aria-hidden="true">◉</span>
        <strong>Perfil</strong>
      </button>
      <button className={active === 'settings' ? 'quick-nav-item active' : 'quick-nav-item'} onClick={() => navigate('/settings')}>
        <span aria-hidden="true">⚙</span>
        <strong>Ajustes</strong>
      </button>
    </nav>
  );
}

function ProfilePage({ user }: { user: ApiUser }) {
  const [fullName, setFullName] = useState(user.fullName);
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await updateProfile(user.id, { fullName, username, email, password: password || undefined });
      setPassword('');
      setMessage('Tus datos se actualizaron correctamente.');
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : 'No fue posible actualizar el perfil.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell profile-shell">
      <header className="page-header profile-header"><h1>Mi perfil</h1></header>
      <main className="content-stack profile-stack">
        <section className="panel profile-panel">
          <p className="eyebrow">Cuenta</p>
          <h2>{user.fullName}</h2>
          <form className="profile-form" onSubmit={save}>
            <label><span>Nombre y apellido</span><input required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label><span>Usuario</span><input required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label><span>Correo electrónico</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label><span>Nueva contraseña</span><input type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Déjala vacía para conservarla" /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            {message && <p className="profile-success" role="status">{message}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Guardando...' : 'Guardar cambios'}</button>
          </form>
        </section>
      </main>
      <QuickNav active="profile" />
    </div>
  );
}

function SharedAccountPage({ userId, user }: { userId: number; user: ApiUser }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const goalId = Number(searchParams.get('goalId'));
  const [invitations, setInvitations] = useState<SharedInvitation[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<ApiUser[]>([]);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const acceptedCount = invitations.filter((invitation) => invitation.status === 'accepted').length;

  useEffect(() => subscribeToInvitations(setInvitations), []);
  useEffect(() => {
    listRegisteredUsers().then(setRegisteredUsers).catch(() => undefined);
  }, []);

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setBusy(true);

    try {
      if (!goalId) throw new Error('Guarda primero la meta compartida para poder invitar integrantes.');
      await sendInvitation(username, goalId);
      setUsername('');
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'No fue posible enviar la invitación.');
    } finally {
      setBusy(false);
    }
  };

  const inviteRegisteredUser = async (registeredUsername: string) => {
    setError('');
    setBusy(true);
    try {
      if (!goalId) throw new Error('Guarda primero la meta compartida para poder invitar integrantes.');
      await sendInvitation(registeredUsername, goalId);
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'No fue posible enviar la invitación.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell shared-shell">
      <main className="content-stack shared-stack">
        <section className="panel shared-intro-panel">
          <h2>Invita personas a tu grupo</h2>
          <p>Invita a otra cuenta AhorraYa. La otra persona podrá aceptar desde su propio dispositivo.</p>
          <div className="shared-summary">
            <strong>{acceptedCount}</strong>
            <span>integrantes aceptaron</span>
          </div>
        </section>

        <section className="panel shared-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Cuentas disponibles</p>
              <h2>Usuarios de prueba</h2>
            </div>
          </div>

          <form className="invite-form" onSubmit={invite}>
            <input required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Usuario de la otra cuenta" />
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Enviando...' : 'Enviar invitación'}</button>
          </form>
          {error && <p className="auth-error" role="alert">{error}</p>}
        </section>

        <section className="panel shared-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Cuentas registradas</p>
              <h2>Elige a quién invitar</h2>
            </div>
          </div>
          <div className="account-directory">
            <div className="account-directory-row current-account">
              <div><strong>Tu cuenta: {user.fullName}</strong><span>@{user.username} · {user.email}</span></div>
            </div>
            {registeredUsers.length > 0 ? registeredUsers.map((registeredUser) => (
              <div className="account-directory-row" key={registeredUser.id}>
                <div><strong>{registeredUser.fullName}</strong><span>@{registeredUser.username} · {registeredUser.email}</span></div>
                <button className="link-button" disabled={busy} onClick={() => void inviteRegisteredUser(registeredUser.username)}>Invitar</button>
              </div>
            )) : <p className="section-empty">Aún no hay otras cuentas registradas.</p>}
          </div>
        </section>

        {invitations.length > 0 && (
          <section className="panel shared-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Bandeja de prueba</p>
                <h2>Responder invitaciones</h2>
              </div>
            </div>

            <div className="invitation-list">
              {invitations.map((invitation) => {
                return (
                  <div className="invitation-row" key={invitation.id}>
                    <div>
                      <strong>{invitation.inviter_name}</strong>
                      <span>Invitación para: {invitation.goal_name}</span>
                    </div>
                    {invitation.status === 'pending' ? (
                      <div className="invitation-actions">
                        <button className="primary-button compact-button" onClick={async () => { await updateInvitationStatus(invitation.id, 'accepted'); setInvitations(await listInvitations()); }}>
                          Aceptar
                        </button>
                        <button className="ghost-button compact-button" onClick={async () => { await updateInvitationStatus(invitation.id, 'declined'); setInvitations(await listInvitations()); }}>
                          Rechazar
                        </button>
                      </div>
                    ) : (
                      <div className="invitation-actions">
                        {invitation.status === 'accepted' && <button className="primary-button compact-button" onClick={() => navigate(`/goals/${invitation.goal_id}`)}>Ver meta</button>}
                        <button className="ghost-button compact-button" onClick={async () => { await deleteInvitation(invitation.id); setInvitations(await listInvitations()); }}>Eliminar</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

      </main>
      <QuickNav active="invitations" />
    </div>
  );
}

function GoalDetailPage({ goalsApi }: { goalsApi: ReturnType<typeof useGoalsData> }) {
  const navigate = useNavigate();
  const { goalId } = useParams();
  const goal = goalId ? goalsApi.goals.find((entry) => entry.id === goalId) : null;
  const currentUser = getCurrentUser();

  useEffect(() => {
    goalsApi.refresh();
  }, []);

  if (!goal) {
    return <MissingGoal onBack={() => navigate('/')} />;
  }

  const monthlyTotal = goal.contributors.reduce((sum, contributor) => sum + contributor.monthlyAmount, 0);
  const savedAmount = getSavedAmount(goal);
  const summary = {
    estimate: getEstimate(savedAmount, goal.goalAmount, monthlyTotal),
    progress: percentOf(goal.goalAmount, savedAmount),
    remaining: Math.max(0, goal.goalAmount - savedAmount),
  };
  const isOwner = goal.ownerId === currentUser?.id;

  const historyEntries = [...goal.monthlyEntries]
    .sort((left, right) => left.year * 12 + left.month - (right.year * 12 + right.month))
    .map((entry) => {
      const collectedAmount = goal.contributors.reduce((total, contributor) => {
        return total + (entry.contributions[contributor.id] ? contributor.monthlyAmount : 0);
      }, 0);

      const paidCount = Object.values(entry.contributions).filter(Boolean).length;

      return {
        ...entry,
        collectedAmount,
        paidCount,
        totalCount: goal.contributors.length,
      };
    });

  const addMonth = () => {
    const monthEntry = createNextMonthEntry(goal);
    goalsApi.patchGoal(goal.id, (currentGoal) => ({
      ...currentGoal,
      monthlyEntries: [...currentGoal.monthlyEntries, monthEntry],
    }));
  };

  const toggleContribution = (entryId: string, contributorId: string) => {
    goalsApi.patchGoal(goal.id, (currentGoal) => ({
      ...currentGoal,
      monthlyEntries: currentGoal.monthlyEntries.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              contributions: {
                ...entry.contributions,
                [contributorId]: !entry.contributions[contributorId],
              },
            }
          : entry,
      ),
    }));
  };

  const progressStyle = {
    background: `conic-gradient(var(--gold) ${summary.progress}%, var(--ring) 0)`,
  };

  return (
    <div className="app-shell detail-shell">
      <header className="page-header detail-header">
        <button className="icon-button" onClick={() => navigate('/')} aria-label="Volver">
          ←
        </button>
        <div className="header-actions">
          <button className="icon-button" onClick={() => navigate('/settings')} aria-label="Configuración">
            ⚙
          </button>
          <button className="icon-button" onClick={() => navigate(`/goals/${goal.id}/edit`)} aria-label="Editar">
            ✎
          </button>
          <button
            className="icon-button danger"
            onClick={async () => {
              if (isOwner) await goalsApi.deleteGoal(goal.id);
              else await goalsApi.leaveGoal(goal.id);
              navigate('/');
            }}
            aria-label={isOwner ? 'Eliminar meta' : 'Salir de la meta'}
          >
            {isOwner ? '🗑' : '↗'}
          </button>
        </div>
      </header>

      <main className="content-stack detail-stack">
        <section className="detail-title-block">
          <p className="eyebrow">Meta compartida</p>
          <h1>{goal.name}</h1>
        </section>

        <section className="panel detail-panel">
          <div className="progress-summary">
            <div className="progress-ring" style={progressStyle}>
              <div className="progress-ring-inner">
                <strong>{summary.progress}%</strong>
              </div>
            </div>

            <div className="summary-columns">
              <div>
                <span>Ahorrado</span>
                <strong>{formatCurrency(savedAmount)}</strong>
              </div>
              <div>
                <span>Meta</span>
                <strong>{formatCurrency(goal.goalAmount)}</strong>
              </div>
              <div>
                <span>Restante</span>
                <strong className="warning">{formatCurrency(summary.remaining)}</strong>
              </div>
            </div>
          </div>

          <hr />

          <div className="calendar-line">
            <span>Estimación de cierre:</span>
            <strong>{summary.estimate ? `${summary.estimate.month} ${summary.estimate.year}` : 'Sin estimación'}</strong>
          </div>

          <hr />

          <div className="contributors-summary">
            {goal.contributors.map((contributor) => (
              <div className="contributor-summary-row" key={contributor.id}>
                <div>
                  <strong>{contributor.name}</strong>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: '100%' }} />
                  </div>
                </div>
                <span>{formatCurrency(contributor.monthlyAmount)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="monthly-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Registro mensual</p>
              <h2>{goal.startYear}</h2>
            </div>
          </div>

          <div className="table-card">
            <div className="table-header">
              <span />
              {goal.contributors.map((contributor) => (
                <span key={contributor.id}>{contributor.name}</span>
              ))}
            </div>

            {goal.monthlyEntries.map((entry) => (
              <div className="table-row" key={entry.id}>
                <strong>{entry.label}</strong>
                {goal.contributors.map((contributor) => (
                  <label className="payment-cell" key={contributor.id}>
                    <input
                      type="checkbox"
                      checked={Boolean(entry.contributions[contributor.id])}
                      onChange={() => toggleContribution(entry.id, contributor.id)}
                    />
                    <span>{formatCompactNumber(contributor.monthlyAmount)}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>

          <div className="action-row">
            <button className="ghost-button wide" onClick={addMonth}>
              + Agregar mes
            </button>
            <button
              className="icon-button danger large"
              onClick={async () => {
                if (isOwner) await goalsApi.deleteGoal(goal.id);
                else await goalsApi.leaveGoal(goal.id);
                navigate('/');
              }}
              aria-label={isOwner ? 'Eliminar meta' : 'Salir de la meta'}
            >
              {isOwner ? '🗑' : '↗'}
            </button>
          </div>
        </section>

        <section className="panel history-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Historial</p>
              <h2>Ingresos de la meta</h2>
            </div>
          </div>

          {historyEntries.length > 0 ? (
            <div className="history-list">
              {historyEntries.map((entry) => (
                <article className="history-item" key={entry.id}>
                  <div className="history-item-top">
                    <div>
                      <strong>{entry.label}</strong>
                      <p>{entry.month + 1}/{entry.year}</p>
                    </div>
                    <strong>{formatCurrency(entry.collectedAmount)}</strong>
                  </div>

                  <div className="history-progress">
                    <div
                      className="history-progress-bar"
                      style={{ width: `${Math.max(10, Math.round((entry.paidCount / Math.max(1, entry.totalCount)) * 100))}%` }}
                    />
                  </div>

                  <div className="history-item-bottom">
                    <span>
                      {entry.paidCount} de {entry.totalCount} aportes
                    </span>
                    <span>{entry.paidCount === entry.totalCount ? 'Completo' : 'Parcial'}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="history-empty">Aún no hay ingresos registrados para esta meta.</p>
          )}
        </section>
      </main>
    </div>
  );
}

function GoalEditorPage({ goalsApi, user }: { goalsApi: ReturnType<typeof useGoalsData>; user: ApiUser }) {
  const navigate = useNavigate();
  const { goalId } = useParams();
  const editingGoal = goalId ? goalsApi.goals.find((goal) => goal.id === goalId) ?? null : null;
  const isCreateMode = !goalId || goalId === 'new';
  const [draftGoal, setDraftGoal] = useState<Goal>(() =>
    editingGoal ? cloneGoal(editingGoal) : cloneGoal({
      ...newGoalTemplate,
      id: createId('goal'),
      contributors: [{ ...newGoalTemplate.contributors[0], name: user.fullName }],
    }),
  );
  const [acceptedUsers, setAcceptedUsers] = useState<ApiUser[]>([]);
  const [selectedMemberUsernames, setSelectedMemberUsernames] = useState<string[]>([]);

  useEffect(() => {
    if (editingGoal) {
      setDraftGoal(cloneGoal(editingGoal));
    }
  }, [editingGoal]);

  useEffect(() => {
    if (draftGoal.shared) {
      listAcceptedUsers().then(setAcceptedUsers).catch(() => setAcceptedUsers([]));
    } else {
      setAcceptedUsers([]);
      setSelectedMemberUsernames([]);
    }
  }, [draftGoal.shared]);

  if (!isCreateMode && !editingGoal) {
    return <MissingGoal onBack={() => navigate('/')} />;
  }

  const monthlyTotal = draftGoal.contributors.reduce((sum, contributor) => sum + contributor.monthlyAmount, 0);
  const estimate = getEstimate(getSavedAmount(draftGoal), draftGoal.goalAmount, monthlyTotal);
  const monthNames = getMonthNames();

  const updateDraft = (patch: Partial<Goal>) => {
    setDraftGoal((currentDraft) => ({ ...currentDraft, ...patch }));
  };

  const updateContributor = (index: number, patch: Partial<Goal['contributors'][number]>) => {
    setDraftGoal((currentDraft) => {
      const contributors = [...currentDraft.contributors];
      contributors[index] = { ...contributors[index], ...patch };
      return { ...currentDraft, contributors };
    });
  };

  const addContributor = () => {
    setDraftGoal((currentDraft) => ({
      ...currentDraft,
      contributors: [...currentDraft.contributors, { id: createId('person'), name: '', monthlyAmount: 0 }],
    }));
  };

  const removeContributor = (contributorId: string) => {
    setDraftGoal((currentDraft) => ({
      ...currentDraft,
      contributors: currentDraft.contributors.filter((contributor) => contributor.id !== contributorId),
      monthlyEntries: currentDraft.monthlyEntries.map((entry) => {
        const { [contributorId]: _removed, ...remainingContributions } = entry.contributions;

        return {
          ...entry,
          contributions: remainingContributions,
        };
      }),
    }));
  };

  const saveDraft = async () => {
    const savedGoal = await goalsApi.saveGoal(draftGoal, selectedMemberUsernames);
    navigate(`/goals/${savedGoal.id}`);
  };

  const saveAndInvite = async () => {
    const savedGoal = await goalsApi.saveGoal(draftGoal, selectedMemberUsernames);
    navigate(`/shared?goalId=${savedGoal.id}`);
  };

  return (
    <div className="app-shell edit-shell">
      <header className="page-header edit-header">
        <button className="icon-button" onClick={() => navigate(editingGoal ? `/goals/${editingGoal.id}` : '/')} aria-label="Volver">
          ←
        </button>
        <div className="edit-header-copy">
          <p className="eyebrow">{isCreateMode ? 'Nueva meta' : 'Editar meta'}</p>
        </div>
        <button className="icon-button" onClick={() => navigate('/settings')} aria-label="Configuración">
          ⚙
        </button>
      </header>

      <main className="content-stack form-stack">
        <section className="panel form-panel">
          <label>
            <span>Nombre del objetivo</span>
            <input value={draftGoal.name} onChange={(event) => updateDraft({ name: event.target.value })} />
          </label>

          <label>
            <span>Monto objetivo</span>
            <input
              inputMode="numeric"
              value={draftGoal.goalAmount}
              onChange={(event) => updateDraft({ goalAmount: Number(event.target.value) || 0 })}
            />
          </label>

          <div className="toggle-row">
            <button
              type="button"
              className={!draftGoal.shared ? 'toggle-option active' : 'toggle-option'}
              onClick={() => updateDraft({
                shared: false,
                contributors: [{ ...(draftGoal.contributors[0] || newGoalTemplate.contributors[0]), name: user.fullName }],
              })}
            >
              Personal
            </button>
            <button
              type="button"
              className={draftGoal.shared ? 'toggle-option active' : 'toggle-option'}
              onClick={() => updateDraft({ shared: true })}
            >
              Compartida
            </button>
          </div>

          {draftGoal.shared && (
            <div className="accepted-members-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Integrantes aceptados</p>
                  <h2>Selecciona usuarios</h2>
                </div>
              </div>
              {acceptedUsers.length > 0 ? (
                <div className="accepted-members-list">
                  {acceptedUsers.map((acceptedUser) => (
                    <label className="accepted-member-option" key={acceptedUser.id}>
                      <input
                        type="checkbox"
                        checked={selectedMemberUsernames.includes(acceptedUser.username)}
                        onChange={() => setSelectedMemberUsernames((current) => current.includes(acceptedUser.username) ? current.filter((username) => username !== acceptedUser.username) : [...current, acceptedUser.username])}
                      />
                      <span><strong>{acceptedUser.fullName}</strong><small>@{acceptedUser.username} · {acceptedUser.email}</small></span>
                    </label>
                  ))}
                </div>
              ) : (
                <>
                  <p className="section-empty">No tienes usuarios aceptados para esta meta.</p>
                  <button type="button" className="ghost-button wide" onClick={() => void saveAndInvite()}>
                    Invitar usuarios
                  </button>
                </>
              )}
            </div>
          )}

          <div className="contributors-editor">
            <div className="section-heading">
              <h2>{draftGoal.shared ? 'Aporte mensual del grupo' : 'Aporte mensual'}</h2>
            </div>

            {draftGoal.contributors.map((contributor, index) => (
              <div className={draftGoal.shared ? 'contributor-grid' : 'contributor-grid personal-contributor'} key={contributor.id}>
                <input
                  value={contributor.name}
                  readOnly={!draftGoal.shared}
                  onChange={(event) => updateContributor(index, { name: event.target.value })}
                  placeholder="Nombre"
                />
                <input
                  inputMode="numeric"
                  value={contributor.monthlyAmount}
                  onChange={(event) => updateContributor(index, { monthlyAmount: Number(event.target.value) || 0 })}
                  placeholder="Monto"
                />
                {draftGoal.shared && (
                  <button type="button" className="icon-button danger compact" onClick={() => removeContributor(contributor.id)} aria-label={`Eliminar integrante ${contributor.name || index + 1}`}>
                    ×
                  </button>
                )}
              </div>
            ))}

            {draftGoal.shared && (
              <button type="button" className="link-button" onClick={addContributor}>
                + Agregar persona
              </button>
            )}
          </div>

          <div className="month-row">
            <label>
              <span>Mes de inicio</span>
              <select value={draftGoal.startMonth} onChange={(event) => updateDraft({ startMonth: Number(event.target.value) })}>
                {monthNames.map((monthName, index) => (
                  <option key={monthName} value={index}>
                    {monthName}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Año</span>
              <input
                inputMode="numeric"
                value={draftGoal.startYear}
                onChange={(event) => updateDraft({ startYear: Number(event.target.value) || new Date().getFullYear() })}
              />
            </label>
          </div>

          <div className="insight-card accent-card">
            <p>
              Ahorrando {formatCurrency(monthlyTotal)} al mes, alcanzarías la meta en aprox.{' '}
              <strong>{estimate ? `${estimate.months} meses` : 'sin estimación'}</strong>.
            </p>
          </div>
        </section>

        <footer className="form-actions">
          <button className="ghost-button" onClick={() => navigate(editingGoal ? `/goals/${editingGoal.id}` : '/')}>
            Cancelar
          </button>
          <button className="primary-button" onClick={saveDraft}>
            Guardar
          </button>
        </footer>
      </main>
    </div>
  );
}

function MissingGoal({ onBack }: { onBack: () => void }) {
  return (
    <div className="app-shell missing-shell">
      <main className="content-stack">
        <section className="panel empty-state">
          <p className="eyebrow">Sin meta</p>
          <h1>La meta no existe o fue eliminada.</h1>
          <button className="primary-button" onClick={onBack}>
            Volver al inicio
          </button>
        </section>
      </main>
    </div>
  );
}

function SettingsPage({
  settings,
  onChangeSettings,
}: {
  settings: AppSettings;
  onChangeSettings: Dispatch<SetStateAction<AppSettings>>;
}) {
  const navigate = useNavigate();

  const updateSettings = (patch: Partial<AppSettings>) => {
    onChangeSettings((currentSettings) => ({ ...currentSettings, ...patch }));
  };

  return (
    <div className="app-shell settings-shell">
      <header className="page-header settings-header">
        <div className="edit-header-copy">
          <p className="eyebrow">Configuración</p>
        </div>
      </header>

      <main className="content-stack settings-stack">
        <section className="panel settings-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Apariencia</p>
              <h2>Modo de color</h2>
            </div>
          </div>

          <div className="toggle-row settings-toggle-row">
            <button
              type="button"
              className={settings.themeMode === 'light' ? 'toggle-option active' : 'toggle-option'}
              onClick={() => updateSettings({ themeMode: 'light' })}
            >
              Claro
            </button>
            <button
              type="button"
              className={settings.themeMode === 'dark' ? 'toggle-option active' : 'toggle-option'}
              onClick={() => updateSettings({ themeMode: 'dark' })}
            >
              Oscuro
            </button>
          </div>

          <div className="palette-grid">
            {paletteOptions.map((palette) => (
              <button
                key={palette.id}
                type="button"
                className={settings.palette === palette.id ? 'palette-card active' : 'palette-card'}
                onClick={() => updateSettings({ palette: palette.id })}
              >
                <span className="palette-swatch" style={{ background: palette.accentDark }} />
                <span className="palette-swatch" style={{ background: palette.accent }} />
                <span className="palette-swatch" style={{ background: palette.accentSoft }} />
                <strong>{palette.label}</strong>
              </button>
            ))}
          </div>
        </section>

        <div className="settings-actions">
          <button className="ghost-button settings-action settings-logout-button" onClick={() => void logoutUser()}>
            Cerrar sesión
          </button>
        </div>
      </main>
      <QuickNav active="settings" />
    </div>
  );
}

function cloneGoal(goal: Goal): Goal {
  return structuredClone(goal);
}

export default App;
