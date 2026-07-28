import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, localDate } from "./api.js";

const PAGE_SIZE = 50;

export function ProductPage({ path, user }) {
  if (user.role === "cleaner") return <CleanerPage path={path} />;

  switch (path) {
    case "/":
      return <DashboardPage />;
    case "/leads":
      return <LeadsPage />;
    case "/quotes":
      return <QuotesPage />;
    case "/customers":
      return <CustomersPage />;
    case "/schedule":
      return <SchedulePage />;
    case "/employees":
      return <EmployeesPage />;
    case "/payments":
      return <PaymentsPage />;
    case "/payroll":
      return <PayrollPage />;
    case "/messages":
      return <MessagesPage />;
    case "/reports":
      return <ReportsPage />;
    case "/settings":
      return <SettingsPage />;
    default:
      return <NotFoundPage />;
  }
}

function useLoad(loader, dependencies) {
  const [state, setInternalState] = useState({ status: "loading", data: null, error: "" });
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setInternalState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const result = await loader();
      if (currentRequest === requestId.current) {
        setInternalState({ status: "ready", data: result, error: "" });
      }
    } catch (error) {
      if (currentRequest === requestId.current) {
        setInternalState({ status: "error", data: null, error: errorMessage(error) });
      }
    }
  }, dependencies);
  const setState = useCallback((nextState) => {
    requestId.current += 1;
    setInternalState(nextState);
  }, []);

  useEffect(() => {
    load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  return { ...state, reload: load, setState };
}

function upsertById(items, item) {
  return [item, ...items.filter((current) => current.id !== item.id)];
}

function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

function PageHeader({ eyebrow, title, description, children }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

function SectionHeader({ eyebrow, title, count, children }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      <div className="section-actions">
        {count !== undefined && <span className="count">{count}</span>}
        {children}
      </div>
    </div>
  );
}

function StatePanel({ title, message, action }) {
  return (
    <div className="status-panel">
      <div className="status-mark" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {action}
    </div>
  );
}

function Pagination({ pagination, onPageChange }) {
  if (!pagination || pagination.total <= pagination.limit) return null;
  const currentPage = Math.floor(pagination.offset / pagination.limit);
  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const first = pagination.offset + 1;
  const last = Math.min(pagination.offset + pagination.limit, pagination.total);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>{first}-{last} of {pagination.total}</span>
      <div>
        <button
          className="secondary-button compact-button"
          disabled={currentPage === 0}
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </button>
        <span>Page {currentPage + 1} of {totalPages}</span>
        <button
          className="secondary-button compact-button"
          disabled={currentPage + 1 >= totalPages}
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

function LoadingRows() {
  return (
    <div className="loading-rows" aria-label="Loading" aria-busy="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function Notice({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div className={`notice-bar notice-${notice.type || "success"}`} role="status">
      <span>{notice.message}</span>
      <button className="text-button" type="button" onClick={onClose}>Dismiss</button>
    </div>
  );
}

function Modal({ title, description, onClose, children }) {
  const panel = useRef(null);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    panel.current?.querySelector("input, select, textarea, button")?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby="modal-title"
        aria-modal="true"
        className="modal-panel"
        ref={panel}
        role="dialog"
      >
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="secondary-button compact-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function FormActions({ saving, disabled = false, danger = false, submitLabel = "Save", onCancel }) {
  return (
    <div className="form-actions">
      <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
      <button className={danger ? "danger-button" : "primary-button inline-button"} disabled={saving || disabled} type="submit">
        {saving ? "Saving..." : submitLabel}
      </button>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function StatusBadge({ status = "active" }) {
  const normalized = String(status).toLowerCase().replaceAll("_", " ");
  return (
    <span className={`status-badge status-${normalized.replaceAll(" ", "-")}`}>
      {normalized}
    </span>
  );
}

function DashboardPage() {
  const resource = useLoad(() => api.dashboard(), []);
  const data = resource.data || {};
  const exceptions = [
    data.overdueLeads > 0 && {
      label: "Overdue leads",
      value: data.overdueLeads,
      detail: "Lead responses have passed the one-hour target.",
      href: "#/leads"
    },
    data.unassignedBookings > 0 && {
      label: "Unassigned bookings",
      value: data.unassignedBookings,
      detail: "Upcoming services still need a team and route.",
      href: "#/schedule"
    },
    data.pendingNotifications > 0 && {
      label: "Queued messages",
      value: data.pendingNotifications,
      detail: "Customer messages are waiting to be sent.",
      href: "#/messages"
    }
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        eyebrow={formatDate(new Date())}
        title="Business overview"
        description="Current staffing, customers, services, and financial position."
      >
        <button className="secondary-button" type="button" onClick={resource.reload}>
          Refresh
        </button>
      </PageHeader>

      <section className="section-block" aria-labelledby="dashboard-summary">
        <SectionHeader
          eyebrow={data.payPeriod ? `${shortDate(data.payPeriod.startsOn)} - ${shortDate(data.payPeriod.endsOn)}` : "Current pay period"}
          title="Company snapshot"
        />
        {resource.status === "loading" && <LoadingRows />}
        {resource.status === "error" && (
          <StatePanel
            title="Dashboard unavailable"
            message={resource.error}
            action={<button className="text-button" onClick={resource.reload}>Try again</button>}
          />
        )}
        {resource.status === "ready" && (
          <div className="metric-grid dashboard-metrics">
            <Metric label="Active employees" value={data.activeEmployees} />
            <Metric label="Active clients" value={data.activeCustomers} />
            <Metric label="Services this week" value={data.servicesThisWeek} />
            <Metric label="Revenue this pay period" value={money(data.revenuePayPeriodCents)} />
            <Metric label="Wages this pay period" value={money(data.wagesPayPeriodCents)} />
            <Metric label="Client balances due" value={money(data.clientCreditsCents)} warning={Number(data.clientCreditsCents) > 0} />
          </div>
        )}
      </section>

      <section className="section-block" aria-labelledby="dashboard-attention">
        <SectionHeader
          eyebrow="Exception queue"
          title="Needs attention"
          count={resource.status === "ready" ? exceptions.length : undefined}
        />
        {resource.status === "loading" && <LoadingRows />}
        {resource.status === "error" && (
          <StatePanel
            title="Dashboard unavailable"
            message={resource.error}
            action={<button className="text-button" onClick={resource.reload}>Try again</button>}
          />
        )}
        {resource.status === "ready" && exceptions.length === 0 && (
          <StatePanel
            title="No urgent exceptions"
            message="Lead response, staffing, and message queues are within their current targets."
          />
        )}
        {resource.status === "ready" && exceptions.length > 0 && (
          <div className="exception-list">
            {exceptions.map((item) => (
              <a className="exception-row exception-link" href={item.href} key={item.label}>
                <span className="severity high" aria-hidden="true" />
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
                <span className="exception-value">{item.value}</span>
              </a>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Metric({ label, value, warning = false }) {
  return (
    <div className={warning ? "metric warning" : "metric"}>
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  );
}

function LeadsPage() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const debouncedSearch = useDebouncedValue(search);
  const resource = useLoad(() => api.get("/leads", {
    status,
    q: debouncedSearch,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  }), [status, debouncedSearch, page]);
  const leads = resource.data?.leads || [];
  const closedStatuses = ["declined", "unresponsive", "duplicate", "not_serviceable"];

  async function exportLeads() {
    try {
      const rows = await loadAllRows("/leads", {
        status,
        q: debouncedSearch
      }, "leads");
      downloadTableCsv({
        filename: "queen-city-maid-leads.csv",
        columns: [
          "Name", "Phone", "Email", "Source", "Status", "Received",
          "Response due", "First responded", "Follow-up due", "Closed reason"
        ],
        rows: rows.map((lead) => [
          lead.name, lead.phone, lead.email, lead.source, lead.status,
          lead.receivedAt, lead.responseDueAt, lead.firstRespondedAt,
          lead.followUpDueAt, lead.closedReason
        ])
      });
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  async function reopenLead(lead) {
    if (!window.confirm(`Reopen ${lead.name}?`)) return;
    try {
      await api.post(`/leads/${lead.id}/reopen`);
      setNotice({ message: "Lead reopened." });
      resource.reload();
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Customer pipeline"
        title="Leads"
        description="New inquiries, response deadlines, follow-up, and outcomes."
      >
        <button className="secondary-button" type="button" onClick={exportLeads}>
          Export filtered CSV
        </button>
        <button className="primary-button inline-button" type="button" onClick={() => setModal({ type: "lead" })}>
          Add lead
        </button>
      </PageHeader>
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <section className="section-block">
        <div className="toolbar">
          <input
            aria-label="Search leads"
            className="search-input"
            placeholder="Search name, phone, or email"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
          <select
            aria-label="Filter lead status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All statuses</option>
            {leadStatuses.map((value) => <option key={value} value={value}>{capitalize(value.replaceAll("_", " "))}</option>)}
          </select>
          <button className="secondary-button" type="button" onClick={resource.reload}>Refresh</button>
        </div>
        {resource.status === "loading" && <LoadingRows />}
        {resource.status === "error" && <StatePanel title="Leads unavailable" message={resource.error} action={<button className="text-button" onClick={resource.reload}>Try again</button>} />}
        {resource.status === "ready" && leads.length === 0 && <StatePanel title="No leads" message="There are no inquiries matching this status." />}
        {resource.status === "ready" && leads.length > 0 && (
          <div className="data-table lead-table">
            <div className="data-row data-head"><span>Lead</span><span>Source</span><span>Received</span><span>Response</span><span>Status</span><span>Actions</span></div>
            {leads.map((lead) => {
              const overdue = lead.status === "new" && new Date(lead.responseDueAt) < new Date();
              return (
                <article className="data-row" key={lead.id}>
                  <div data-label="Lead"><strong>{lead.name}</strong><small>{lead.phone || lead.email}</small></div>
                  <div data-label="Source"><span>{lead.source}</span><small>{lead.ownerName || "Unassigned"}</small></div>
                  <div data-label="Received">{dateTime(lead.receivedAt)}</div>
                  <div data-label="Response">
                    {lead.firstRespondedAt ? dateTime(lead.firstRespondedAt) : <span className={overdue ? "overdue-text" : ""}>Due {dateTime(lead.responseDueAt)}</span>}
                  </div>
                  <div data-label="Status"><StatusBadge status={lead.status} /></div>
                  <div className="row-actions" data-label="Actions">
                    <button className="text-button" type="button" onClick={() => setModal({ type: "activity", lead })}>Activity</button>
                    <button className="text-button" type="button" onClick={() => setModal({ type: "lead", item: lead })}>Edit</button>
                    {!closedStatuses.includes(lead.status) && lead.status !== "converted" && (
                      <>
                        <button className="text-button" type="button" onClick={() => setModal({ type: "convert", lead })}>Convert</button>
                        <button className="text-button danger-text" type="button" onClick={() => setModal({ type: "close", lead })}>Close lead</button>
                      </>
                    )}
                    {closedStatuses.includes(lead.status) && (
                      <button className="text-button" type="button" onClick={() => reopenLead(lead)}>Reopen</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <Pagination pagination={resource.data?.pagination} onPageChange={setPage} />
      </section>
      {modal?.type === "lead" && (
        <Modal title={modal.item ? "Edit lead" : "Add lead"} onClose={() => setModal(null)}>
          <LeadForm
            lead={modal.item}
            onCancel={() => setModal(null)}
            onSaved={(message) => {
              setModal(null);
              setNotice({ message });
              setStatus("");
              setSearch("");
              setPage(0);
              resource.reload();
            }}
          />
        </Modal>
      )}
      {modal?.type === "activity" && (
        <LeadActivityManager
          lead={modal.lead}
          onClose={() => setModal(null)}
          onSaved={(message) => {
            setNotice({ message });
            resource.reload();
          }}
        />
      )}
      {modal?.type === "close" && (
        <Modal title={`Close lead - ${modal.lead.name}`} onClose={() => setModal(null)}>
          <CloseLeadForm
            lead={modal.lead}
            onCancel={() => setModal(null)}
            onSaved={() => {
              setModal(null);
              setNotice({ message: "Lead closed." });
              resource.reload();
            }}
          />
        </Modal>
      )}
      {modal?.type === "convert" && (
        <Modal
          title={`Convert lead - ${modal.lead.name}`}
          description="Create or link the customer record and optionally add the first property."
          onClose={() => setModal(null)}
        >
          <ConvertLeadForm
            lead={modal.lead}
            onCancel={() => setModal(null)}
            onSaved={() => {
              setModal(null);
              setNotice({ message: "Lead converted to an active customer." });
              resource.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}

const leadStatuses = [
  "new", "contacted", "awaiting_information", "quote_ready", "converted",
  "declined", "unresponsive", "duplicate", "not_serviceable"
];
const editableLeadStatuses = [
  "new", "contacted", "awaiting_information", "quote_ready"
];

function LeadForm({ lead, onCancel, onSaved }) {
  const owners = useLoad(() => api.get("/users"), []);
  const [form, setForm] = useState({
    ownerUserId: lead?.ownerUserId || "",
    source: lead?.source || "Phone",
    name: lead?.name || "",
    phone: lead?.phone || "",
    email: lead?.email || "",
    message: lead?.message || "",
    status: lead?.status || "new",
    followUpDueAt: localDateTime(lead?.followUpDueAt),
    closedReason: lead?.closedReason || ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const common = {
      ...(form.ownerUserId ? { ownerUserId: form.ownerUserId } : {}),
      source: form.source,
      name: form.name,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      message: form.message
    };
    const payload = lead ? {
      ...common,
      ...(form.status !== lead.status ? { status: form.status } : {}),
      followUpDueAt: form.followUpDueAt ? new Date(form.followUpDueAt).toISOString() : null,
      expectedUpdatedAt: lead.updatedAt
    } : common;
    try {
      if (lead) await api.patch(`/leads/${lead.id}`, payload);
      else await api.post("/leads", payload);
      onSaved(lead ? "Lead updated." : "Lead added.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Name"><input required maxLength="200" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="Source"><input required maxLength="100" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} /></Field>
        <Field label="Owner">
          <select value={form.ownerUserId} onChange={(event) => setForm({ ...form, ownerUserId: event.target.value })}>
            {!lead && <option value="">Current manager</option>}
            {(owners.data?.users || [])
              .filter((user) => user.role === "manager" && user.active)
              .map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </Field>
        <Field label="Phone"><input maxLength="30" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
        <Field label="Email"><input maxLength="254" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
        {lead && (
          <>
            <Field label="Status">
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                {!editableLeadStatuses.includes(form.status) && (
                  <option value={form.status} disabled>
                    {capitalize(form.status.replaceAll("_", " "))}
                  </option>
                )}
                {editableLeadStatuses.map((value) => <option key={value} value={value}>{capitalize(value.replaceAll("_", " "))}</option>)}
              </select>
            </Field>
            <Field label="Follow-up due">
              <input type="datetime-local" value={form.followUpDueAt} onChange={(event) => setForm({ ...form, followUpDueAt: event.target.value })} />
            </Field>
          </>
        )}
      </div>
      <Field label="Inquiry"><textarea rows="4" maxLength="5000" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></Field>
      {!form.phone.trim() && !form.email.trim() && <p className="form-error">Enter a phone number or email address.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} disabled={!form.phone.trim() && !form.email.trim()} onCancel={onCancel} submitLabel={lead ? "Save changes" : "Add lead"} />
    </form>
  );
}

function CloseLeadForm({ lead, onCancel, onSaved }) {
  const [status, setStatus] = useState("declined");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/leads/${lead.id}/close`, { status, reason });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Outcome">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="declined">Declined</option>
          <option value="unresponsive">Unresponsive</option>
          <option value="duplicate">Duplicate</option>
          <option value="not_serviceable">Not serviceable</option>
        </select>
      </Field>
      <Field label="Reason">
        <textarea required maxLength="1000" rows="3" value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions danger saving={saving} onCancel={onCancel} submitLabel="Close lead" />
    </form>
  );
}

function ConvertLeadForm({ lead, onCancel, onSaved }) {
  const [form, setForm] = useState({
    customerType: "residential",
    serviceFrequency: "",
    paymentMethod: "",
    internalNotes: "",
    includeProperty: false,
    addressLine1: "",
    addressLine2: "",
    city: "Charlotte",
    state: "NC",
    postalCode: "",
    squareFeet: "",
    condition: "",
    pets: "",
    serviceNotes: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      customerType: form.customerType,
      serviceFrequency: form.serviceFrequency || null,
      paymentMethod: form.paymentMethod || null,
      internalNotes: form.internalNotes,
      property: form.includeProperty ? {
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2,
        city: form.city,
        state: form.state,
        postalCode: form.postalCode,
        squareFeet: form.squareFeet ? Number(form.squareFeet) : null,
        condition: form.condition || null,
        pets: form.pets,
        serviceNotes: form.serviceNotes
      } : null
    };
    try {
      await api.post(`/leads/${lead.id}/convert`, payload);
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Customer type">
          <select value={form.customerType} onChange={(event) => setForm({ ...form, customerType: event.target.value })}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
            <option value="realtor">Realtor</option>
          </select>
        </Field>
        <Field label="Service frequency">
          <select value={form.serviceFrequency} onChange={(event) => setForm({ ...form, serviceFrequency: event.target.value })}>
            <option value="">Not set</option>
            <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option><option value="other">Other</option>
          </select>
        </Field>
        <Field label="Payment method">
          <select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}>
            <option value="">Not set</option>
            <option value="zelle">Zelle</option><option value="venmo">Venmo</option>
            <option value="paypal">PayPal</option><option value="cash">Cash</option>
            <option value="check">Check</option><option value="other">Other</option>
          </select>
        </Field>
      </div>
      <Field label="Internal notes">
        <textarea maxLength="5000" rows="3" value={form.internalNotes} onChange={(event) => setForm({ ...form, internalNotes: event.target.value })} />
      </Field>
      <label className="checkbox-field">
        <input type="checkbox" checked={form.includeProperty} onChange={(event) => setForm({ ...form, includeProperty: event.target.checked })} />
        Add the first property
      </label>
      {form.includeProperty && (
        <>
          <div className="form-grid">
            <Field label="Address"><input required maxLength="200" value={form.addressLine1} onChange={(event) => setForm({ ...form, addressLine1: event.target.value })} /></Field>
            <Field label="Address line 2"><input maxLength="200" value={form.addressLine2} onChange={(event) => setForm({ ...form, addressLine2: event.target.value })} /></Field>
            <Field label="City"><input required maxLength="100" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></Field>
            <Field label="State"><input required maxLength="2" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} /></Field>
            <Field label="Postal code"><input required maxLength="20" value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} /></Field>
            <Field label="Square feet"><input min="1" type="number" value={form.squareFeet} onChange={(event) => setForm({ ...form, squareFeet: event.target.value })} /></Field>
            <Field label="Condition"><input maxLength="100" value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} /></Field>
            <Field label="Pets"><input maxLength="1000" value={form.pets} onChange={(event) => setForm({ ...form, pets: event.target.value })} /></Field>
          </div>
          <Field label="Property notes">
            <textarea maxLength="5000" rows="3" value={form.serviceNotes} onChange={(event) => setForm({ ...form, serviceNotes: event.target.value })} />
          </Field>
        </>
      )}
      {!lead.phone && (
        <p className="form-error">Add a phone number to this lead before creating a new customer.</p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} disabled={!lead.phone} onCancel={onCancel} submitLabel="Convert lead" />
    </form>
  );
}

function LeadActivityManager({ lead, onClose, onSaved }) {
  const resource = useLoad(() => api.get(`/leads/${lead.id}`), [lead.id]);
  const [type, setType] = useState("note");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/leads/${lead.id}/activities`, { type, body });
      setBody("");
      onSaved("Lead activity recorded.");
      resource.reload();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`${lead.name} - Activity`} onClose={onClose}>
      {resource.status === "loading" && <LoadingRows />}
      {resource.status === "error" && <StatePanel title="Activity unavailable" message={resource.error} />}
      {resource.status === "ready" && (
        <>
          <div className="stack-list compact-list">
            {(resource.data.activities || []).length === 0 && <StatePanel title="No activity" message="Record the first customer contact or internal note." />}
            {(resource.data.activities || []).map((activity) => (
              <article className="stack-row" key={activity.id}>
                <div><strong>{capitalize(activity.type.replaceAll("_", " "))}</strong><p>{activity.body}</p><small>{dateTime(activity.occurredAt)}</small></div>
              </article>
            ))}
          </div>
          <form className="modal-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Activity type">
                <select value={type} onChange={(event) => setType(event.target.value)}>
                  <option value="note">Note</option><option value="call">Call</option><option value="text">Text</option>
                  <option value="email">Email</option><option value="status_change">Status change</option><option value="follow_up">Follow-up</option>
                </select>
              </Field>
            </div>
            <Field label="Details"><textarea required rows="3" maxLength="5000" value={body} onChange={(event) => setBody(event.target.value)} /></Field>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button inline-button" disabled={saving} type="submit">{saving ? "Recording..." : "Record activity"}</button>
          </form>
        </>
      )}
    </Modal>
  );
}

function QuotesPage() {
  const [status, setStatus] = useState("");
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const resource = useLoad(
    () => api.get("/quotes", { status, limit: 100 }),
    [status]
  );
  const quotes = resource.data?.quotes || [];

  function changed(message) {
    setModal(null);
    setNotice({ message });
    resource.reload();
  }

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Quotes"
        description="Pricing prepared for customer review and recorded customer decisions."
      >
        <button className="primary-button inline-button" type="button" onClick={() => setModal({ type: "create" })}>
          Create quote
        </button>
      </PageHeader>
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <section className="section-block">
        <div className="toolbar">
          <select aria-label="Filter quote status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {["draft", "sent", "approved", "needs_review", "declined", "superseded"].map((value) => (
              <option key={value} value={value}>{capitalize(value.replaceAll("_", " "))}</option>
            ))}
          </select>
          <button className="secondary-button" type="button" onClick={resource.reload}>Refresh</button>
        </div>
        {resource.status === "loading" && <LoadingRows />}
        {resource.status === "error" && <StatePanel title="Quotes unavailable" message={resource.error} />}
        {resource.status === "ready" && !quotes.length && (
          <StatePanel title="No quotes" message="No quotes match this status." />
        )}
        {resource.status === "ready" && quotes.length > 0 && (
          <div className="data-table quote-table">
            <div className="data-row data-head">
              <span>Customer</span><span>Property</span><span>Pricing</span>
              <span>Total</span><span>Status</span><span>Actions</span>
            </div>
            {quotes.map((quote) => (
              <article className="data-row" key={quote.id}>
                <div data-label="Customer"><strong>{quote.customerName}</strong></div>
                <div data-label="Property">
                  <strong>{quote.addressLine1}</strong>
                  <small>{quote.city}, {quote.postalCode}</small>
                </div>
                <div data-label="Pricing">{capitalize(quote.pricingType.replaceAll("_", " "))}</div>
                <div data-label="Total"><strong>{money(quote.subtotalCents)}</strong></div>
                <div data-label="Status"><StatusBadge status={quote.status.replaceAll("_", " ")} /></div>
                <div data-label="Actions">
                  <button className="text-button" type="button" onClick={() => setModal({ type: "detail", quote })}>
                    Manage
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {modal?.type === "create" && (
        <Modal title="Create quote" onClose={() => setModal(null)}>
          <QuoteForm
            onCancel={() => setModal(null)}
            onSaved={() => changed("Quote created.")}
          />
        </Modal>
      )}
      {modal?.type === "detail" && (
        <QuoteManager
          quote={modal.quote}
          onClose={() => setModal(null)}
          onChanged={changed}
        />
      )}
    </>
  );
}

function QuoteForm({ onCancel, onSaved }) {
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedSearch = useDebouncedValue(customerSearch);
  const customers = useLoad(
    () => api.list("customers", { q: debouncedSearch, limit: 20 }),
    [debouncedSearch]
  );
  const serviceTypes = useLoad(
    () => api.list("service-types", { active: true, limit: 100 }),
    []
  );
  const [form, setForm] = useState({
    customerId: "",
    propertyId: "",
    pricingType: "flat",
    hourlyRate: "99",
    estimatedHours: "",
    serviceTypeId: "",
    description: "",
    amount: "",
    notes: ""
  });
  const properties = useLoad(
    () => form.customerId
      ? api.list("properties", { customerId: form.customerId, active: true, limit: 100 })
      : Promise.resolve({ properties: [] }),
    [form.customerId]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const flat = form.pricingType === "flat";

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post("/quotes", {
        customerId: form.customerId,
        propertyId: form.propertyId,
        pricingType: form.pricingType,
        hourlyRateCents: form.pricingType === "hourly_team" ? cents(form.hourlyRate) : null,
        estimatedHours: form.pricingType === "hourly_team" ? Number(form.estimatedHours) : null,
        notes: form.notes,
        items: flat ? [{
          serviceTypeId: form.serviceTypeId || null,
          description: form.description,
          quantity: 1,
          unitPriceCents: cents(form.amount),
          sortOrder: 0
        }] : []
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Find customer">
        <input type="search" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="Customer">
          <select required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value, propertyId: "" })}>
            <option value="">Select customer</option>
            {(customers.data?.customers || []).map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name} - {customer.phone}</option>
            ))}
          </select>
        </Field>
        <Field label="Property">
          <select required value={form.propertyId} onChange={(event) => setForm({ ...form, propertyId: event.target.value })}>
            <option value="">Select property</option>
            {(properties.data?.properties || []).map((property) => (
              <option key={property.id} value={property.id}>{property.addressLine1}, {property.city}</option>
            ))}
          </select>
        </Field>
        <Field label="Pricing">
          <select value={form.pricingType} onChange={(event) => setForm({ ...form, pricingType: event.target.value })}>
            <option value="flat">Flat quote</option>
            <option value="hourly_team">Hourly team</option>
            <option value="inspection">Inspection required</option>
          </select>
        </Field>
      </div>
      {flat && (
        <div className="form-grid">
          <Field label="Service">
            <select value={form.serviceTypeId} onChange={(event) => {
              const selected = serviceTypes.data?.serviceTypes?.find((service) => service.id === event.target.value);
              setForm({
                ...form,
                serviceTypeId: event.target.value,
                description: selected?.name || form.description
              });
            }}>
              <option value="">No service type</option>
              {(serviceTypes.data?.serviceTypes || []).map((service) => (
                <option key={service.id} value={service.id}>{service.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <input required maxLength="500" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <Field label="Quoted amount">
            <input required min="0" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          </Field>
        </div>
      )}
      {form.pricingType === "hourly_team" && (
        <div className="form-grid">
          <Field label="Hourly rate">
            <input required min="0" step="0.01" type="number" value={form.hourlyRate} onChange={(event) => setForm({ ...form, hourlyRate: event.target.value })} />
          </Field>
          <Field label="Estimated hours">
            <input required min="0.25" step="0.25" type="number" value={form.estimatedHours} onChange={(event) => setForm({ ...form, estimatedHours: event.target.value })} />
          </Field>
        </div>
      )}
      <Field label="Quote notes">
        <textarea maxLength="5000" rows="4" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions
        saving={saving}
        disabled={!form.customerId || !form.propertyId}
        onCancel={onCancel}
        submitLabel="Create quote"
      />
    </form>
  );
}

function QuoteManager({ quote, onClose, onChanged }) {
  const resource = useLoad(() => api.get(`/quotes/${quote.id}`), [quote.id]);
  const serviceTypes = useLoad(
    () => api.list("service-types", { active: true, limit: 100 }),
    []
  );
  const [item, setItem] = useState({ serviceTypeId: "", description: "", amount: "" });
  const [decision, setDecision] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const current = resource.data?.quote;

  async function addItem(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/quotes/${quote.id}/items`, {
        serviceTypeId: item.serviceTypeId || null,
        description: item.description,
        quantity: 1,
        unitPriceCents: cents(item.amount),
        sortOrder: resource.data?.items?.length || 0
      });
      setItem({ serviceTypeId: "", description: "", amount: "" });
      resource.reload();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(itemId) {
    if (!window.confirm("Remove this quote item?")) return;
    try {
      await api.remove(`/quotes/${quote.id}/items/${itemId}`);
      resource.reload();
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  async function markSent() {
    if (!window.confirm("Mark this quote as sent to the customer?")) return;
    try {
      await api.post(`/quotes/${quote.id}/send`);
      onChanged("Quote marked as sent.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  async function recordDecision(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/quotes/${quote.id}/${decision.type}`, {
        replyText: decision.replyText
      });
      onChanged(decision.type === "approve" ? "Quote approved." : "Quote declined.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Quote - ${quote.customerName}`} onClose={onClose}>
      {resource.status === "loading" && <LoadingRows />}
      {resource.status === "error" && <StatePanel title="Quote unavailable" message={resource.error} />}
      {resource.status === "ready" && current && (
        <>
          <div className="quote-summary">
            <div><span>Status</span><StatusBadge status={current.status.replaceAll("_", " ")} /></div>
            <div><span>Property</span><strong>{current.addressLine1}, {current.city}</strong></div>
            <div><span>Total</span><strong>{money(current.subtotalCents)}</strong></div>
          </div>
          <div className="stack-list compact-list">
            {!resource.data.items.length && (
              <StatePanel title="No line items" message="Add pricing after the property inspection." />
            )}
            {resource.data.items.map((quoteItem) => (
              <article className="stack-row" key={quoteItem.id}>
                <div>
                  <strong>{quoteItem.description}</strong>
                  <p>{quoteItem.serviceName || "Custom item"} · {money(quoteItem.lineTotalCents)}</p>
                </div>
                {!["declined", "superseded"].includes(current.status) && (
                  <button className="text-button danger-text" type="button" onClick={() => removeItem(quoteItem.id)}>
                    Remove
                  </button>
                )}
              </article>
            ))}
          </div>
          {!["declined", "superseded"].includes(current.status) && (
            <form className="modal-form quote-item-form" onSubmit={addItem}>
              <div className="form-grid">
                <Field label="Service">
                  <select value={item.serviceTypeId} onChange={(event) => {
                    const selected = serviceTypes.data?.serviceTypes?.find((service) => service.id === event.target.value);
                    setItem({
                      ...item,
                      serviceTypeId: event.target.value,
                      description: selected?.name || item.description
                    });
                  }}>
                    <option value="">Custom item</option>
                    {(serviceTypes.data?.serviceTypes || []).map((service) => (
                      <option key={service.id} value={service.id}>{service.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Item description">
                  <input required maxLength="500" value={item.description} onChange={(event) => setItem({ ...item, description: event.target.value })} />
                </Field>
                <Field label="Item amount">
                  <input required min="0" step="0.01" type="number" value={item.amount} onChange={(event) => setItem({ ...item, amount: event.target.value })} />
                </Field>
              </div>
              <button className="secondary-button" disabled={saving} type="submit">Add item</button>
            </form>
          )}
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={onClose}>Close</button>
            {["draft", "needs_review"].includes(current.status) && (
              <button className="primary-button" type="button" onClick={markSent}>Mark sent</button>
            )}
            {current.status === "sent" && (
              <>
                <button className="secondary-button" type="button" onClick={() => setDecision({ type: "decline", replyText: "" })}>Record decline</button>
                <button className="primary-button" type="button" onClick={() => setDecision({ type: "approve", replyText: "" })}>Record approval</button>
              </>
            )}
          </div>
          {decision && (
            <form className="modal-form quote-decision-form" onSubmit={recordDecision}>
              <Field label="Customer reply">
                <textarea required maxLength="5000" rows="3" value={decision.replyText} onChange={(event) => setDecision({ ...decision, replyText: event.target.value })} />
              </Field>
              <FormActions
                danger={decision.type === "decline"}
                saving={saving}
                onCancel={() => setDecision(null)}
                submitLabel={decision.type === "approve" ? "Approve quote" : "Decline quote"}
              />
            </form>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </>
      )}
    </Modal>
  );
}

function CustomersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const debouncedSearch = useDebouncedValue(search);
  const resource = useLoad(() => api.list("customers", {
    status,
    q: debouncedSearch,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  }), [status, debouncedSearch, page]);
  const customers = resource.data?.customers || [];

  async function exportCustomers() {
    try {
      const rows = await loadAllRows("/customers", {
        status,
        q: debouncedSearch
      }, "customers");
      downloadTableCsv({
        filename: "queen-city-maid-customers.csv",
        columns: [
          "Name", "Type", "Phone", "Email", "Status", "Frequency",
          "Payment method", "Preferred channel", "Properties", "Internal notes"
        ],
        rows: rows.map((customer) => [
          customer.name, customer.type, customer.phone, customer.email,
          customer.status, customer.serviceFrequency, customer.paymentMethod,
          customer.preferredChannel, customer.propertyCount, customer.internalNotes
        ])
      });
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  async function paymentReminder(customer) {
    try {
      await api.post(`/customers/${customer.id}/payment-reminder`);
      setNotice({ message: `Payment reminder queued for ${customer.name}.` });
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  async function reactivateCustomer(customer) {
    if (!window.confirm(
      `Reactivate ${customer.name}? Cancelled visits and ended recurring services will stay closed.`
    )) return;
    try {
      await api.post(`/customers/${customer.id}/reactivate`);
      setNotice({ message: `${customer.name} was reactivated.` });
      resource.reload();
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  async function customerLifecycle(customer, action) {
    const prompt = action === "pause"
      ? `Pause ${customer.name}? Future unstarted visits and reminders will be cancelled.`
      : `Resume ${customer.name}? Service plans will stay paused until a manager restarts them.`;
    if (!window.confirm(prompt)) return;
    try {
      await api.post(`/customers/${customer.id}/${action}`);
      setNotice({
        message: action === "pause"
          ? `${customer.name} was paused and future visits were stopped.`
          : `${customer.name} was resumed. Restart a service plan when they are ready.`
      });
      resource.reload();
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Customer records"
        title="Customers"
        description="Contacts, service frequency, payment preferences, properties, and communication consent."
      >
        <button className="secondary-button" type="button" onClick={exportCustomers}>
          Export filtered CSV
        </button>
        <button className="primary-button inline-button" type="button" onClick={() => setModal({ type: "customer" })}>
          Add customer
        </button>
      </PageHeader>
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <section className="section-block">
        <div className="toolbar">
          <input
            aria-label="Search customers"
            className="search-input"
            placeholder="Search name, phone, or email"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
          <select
            aria-label="Filter customer status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="lead">Lead</option>
            <option value="inactive">Inactive</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button className="secondary-button" type="button" onClick={resource.reload}>Refresh</button>
        </div>

        {resource.status === "loading" && <LoadingRows />}
        {resource.status === "error" && (
          <StatePanel title="Customers unavailable" message={resource.error} action={<button className="text-button" onClick={resource.reload}>Try again</button>} />
        )}
        {resource.status === "ready" && customers.length === 0 && (
          <StatePanel title="No matching customers" message="Change the filters or add a customer record." />
        )}
        {resource.status === "ready" && customers.length > 0 && (
          <div className="data-table customer-table">
            <div className="data-row data-head">
              <span>Customer</span><span>Contact</span><span>Status</span><span>Preferences</span><span>Properties</span><span>Actions</span>
            </div>
            {customers.map((customer) => (
                <article className="data-row" key={customer.id}>
                  <div data-label="Customer">
                    <strong>{customer.name}</strong>
                    <small>{capitalize(customer.type)}</small>
                  </div>
                  <div data-label="Contact">
                    <span>{customer.phone}</span>
                    <small>{customer.email || "No email"}</small>
                  </div>
                  <div data-label="Status"><StatusBadge status={customer.status} /></div>
                  <div data-label="Preferences">
                    <span className={customer.serviceFrequency === "other" ? "customer-frequency-note" : ""}>
                      {customer.serviceFrequency === "other"
                        ? customer.internalNotes || "Other schedule details not set"
                        : customer.serviceFrequency
                          ? capitalize(customer.serviceFrequency)
                          : "Frequency not set"}
                    </span>
                    <small>{paymentMethodLabel(customer.paymentMethod)}</small>
                  </div>
                  <div data-label="Properties">
                    <button className="text-button" type="button" onClick={() => setModal({ type: "properties", customer })}>
                      {customer.propertyCount} {customer.propertyCount === 1 ? "property" : "properties"}
                    </button>
                  </div>
                  <div className="row-actions" data-label="Actions">
                    <button className="text-button" type="button" onClick={() => setModal({ type: "customer", item: customer })}>Edit</button>
                    <button className="text-button" type="button" onClick={() => setModal({ type: "consent", customer })}>Text consent</button>
                    <button className="text-button" type="button" onClick={() => paymentReminder(customer)}>Payment reminder</button>
                    {customer.status === "active" && (
                      <button className="text-button" type="button" onClick={() => customerLifecycle(customer, "pause")}>Pause services</button>
                    )}
                    {["paused", "inactive"].includes(customer.status) && (
                      <button className="text-button" type="button" onClick={() => customerLifecycle(customer, "resume")}>Resume customer</button>
                    )}
                    {customer.status !== "cancelled" && (
                      <button className="text-button danger-text" type="button" onClick={() => setModal({ type: "cancel-customer", customer })}>Cancel customer</button>
                    )}
                    {customer.status === "cancelled" && (
                      <button className="text-button" type="button" onClick={() => reactivateCustomer(customer)}>Reactivate customer</button>
                    )}
                  </div>
                </article>
            ))}
          </div>
        )}
        <Pagination pagination={resource.data?.pagination} onPageChange={setPage} />
      </section>

      {modal?.type === "customer" && (
        <Modal title={modal.item ? "Edit customer" : "Add customer"} onClose={() => setModal(null)}>
          <CustomerForm
            customer={modal.item}
            onCancel={() => setModal(null)}
            onSaved={(message, savedCustomer) => {
              setModal(null);
              setNotice({ message });
              setStatus("");
              setSearch(savedCustomer.name);
              setPage(0);
              resource.setState((current) => {
                const data = current.data || { customers: [], pagination: null };
                return {
                  status: "ready",
                  error: "",
                  data: {
                    ...data,
                    customers: upsertById(data.customers || [], {
                      ...savedCustomer,
                      propertyCount: savedCustomer.propertyCount || 0
                    })
                  }
                };
              });
            }}
          />
        </Modal>
      )}
      {modal?.type === "properties" && (
        <PropertyManager
          customer={modal.customer}
          onClose={() => setModal(null)}
          onChanged={(message) => {
            setNotice({ message });
            resource.reload();
          }}
        />
      )}
      {modal?.type === "consent" && (
        <Modal title={`Text consent - ${modal.customer.name}`} onClose={() => setModal(null)}>
          <ConsentForm
            customer={modal.customer}
            onCancel={() => setModal(null)}
            onSaved={(message) => {
              setModal(null);
              setNotice({ message });
            }}
          />
        </Modal>
      )}
      {modal?.type === "cancel-customer" && (
        <Modal
          title={`Cancel ${modal.customer.name}`}
          description="Future visits and reminders will be cancelled. Prior services and balances remain."
          onClose={() => setModal(null)}
        >
          <CancelCustomerForm
            customer={modal.customer}
            onCancel={() => setModal(null)}
            onSaved={() => {
              setModal(null);
              setNotice({ message: `${modal.customer.name} was cancelled.` });
              resource.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}

function CustomerForm({ customer, onCancel, onSaved }) {
  const [form, setForm] = useState({
    type: customer?.type || "residential",
    name: customer?.name || "",
    email: customer?.email || "",
    phone: customer?.phone || "",
    preferredChannel: customer?.preferredChannel || "sms",
    serviceFrequency: customer?.serviceFrequency || "",
    paymentMethod: customer?.paymentMethod || "",
    status: customer?.status || "active",
    internalNotes: customer?.internalNotes || ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const { status, ...details } = form;
    const payload = {
      ...details,
      email: form.email.trim() || null,
      serviceFrequency: form.serviceFrequency || null,
      paymentMethod: form.paymentMethod || null,
      ...(!customer ? { status } : {})
    };
    try {
      const result = customer
        ? await api.update("customers", customer.id, payload)
        : await api.create("customers", payload);
      onSaved(customer ? "Customer updated." : "Customer added.", result.customer);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Customer type">
          <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
            <option value="realtor">Realtor</option>
          </select>
        </Field>
        {!customer && (
          <Field label="Status">
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="active">Active</option>
              <option value="lead">Lead</option>
            </select>
          </Field>
        )}
        <Field label="Name">
          <input required maxLength="200" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Phone">
          <input required maxLength="30" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        </Field>
        <Field label="Email">
          <input maxLength="254" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </Field>
        <Field label="Preferred channel">
          <select value={form.preferredChannel} onChange={(event) => setForm({ ...form, preferredChannel: event.target.value })}>
            <option value="sms">Text message</option>
            <option value="phone">Phone</option>
            <option value="email">Email</option>
          </select>
        </Field>
        <Field label="Service frequency">
          <select value={form.serviceFrequency} onChange={(event) => setForm({ ...form, serviceFrequency: event.target.value })}>
            <option value="">Not set</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Payment method">
          <select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}>
            <option value="">Not set</option>
            <option value="zelle">Zelle</option>
            <option value="venmo">Venmo</option>
            <option value="paypal">PayPal</option>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
          </select>
        </Field>
      </div>
      <Field label="Internal notes">
        <textarea rows="4" maxLength="5000" value={form.internalNotes} onChange={(event) => setForm({ ...form, internalNotes: event.target.value })} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={customer ? "Save changes" : "Add customer"} />
    </form>
  );
}

function CancelCustomerForm({ customer, onCancel, onSaved }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/customers/${customer.id}/cancel`, { reason });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Cancellation reason">
        <textarea
          autoFocus
          maxLength="1000"
          placeholder="Optional"
          rows="3"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions
        danger
        saving={saving}
        onCancel={onCancel}
        submitLabel="Cancel customer"
      />
    </form>
  );
}

function PropertyManager({ customer, onClose, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const resource = useLoad(() => api.list("properties", {
    customerId: customer.id,
    active: true,
    q: debouncedSearch,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  }), [customer.id, debouncedSearch, page]);
  const properties = resource.data?.properties || [];

  async function deleteProperty(property) {
    if (!window.confirm(`Delete ${property.label || property.addressLine1}?`)) return;
    setDeletingId(property.id);
    setError("");
    try {
      await api.remove(`/properties/${property.id}`);
      onChanged("Property deleted.");
      if (properties.length === 1 && page > 0) {
        setPage(page - 1);
      } else {
        resource.reload();
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setDeletingId("");
    }
  }

  return (
    <Modal title={`${customer.name} - Properties`} onClose={onClose}>
      {!editing && (
        <>
          <div className="modal-toolbar">
            <p>{resource.data?.pagination?.total || 0} properties</p>
            <button className="primary-button inline-button" type="button" onClick={() => setEditing({})}>Add property</button>
          </div>
          <input
            aria-label="Search properties"
            className="search-input"
            placeholder="Search address, city, or postal code"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
          {resource.status === "loading" && <LoadingRows />}
          {resource.status === "error" && (
            <StatePanel title="Properties unavailable" message={resource.error} action={<button className="text-button" onClick={resource.reload}>Try again</button>} />
          )}
          {resource.status === "ready" && properties.length === 0 ? (
            <StatePanel title="No properties" message="Add the location where service will be performed." />
          ) : resource.status === "ready" ? (
            <div className="stack-list">
              {properties.map((property) => (
                <article className="stack-row" key={property.id}>
                  <div>
                    <strong>{property.label}</strong>
                    <p>{property.addressLine1}{property.addressLine2 ? `, ${property.addressLine2}` : ""}</p>
                    <small>{property.city}, {property.state} {property.postalCode}</small>
                  </div>
                  <div className="row-actions">
                    <button className="text-button" type="button" onClick={() => setEditing(property)}>Edit</button>
                    <button
                      className="text-button danger-text"
                      disabled={deletingId === property.id}
                      type="button"
                      onClick={() => deleteProperty(property)}
                    >
                      {deletingId === property.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          <Pagination pagination={resource.data?.pagination} onPageChange={setPage} />
          {error && <p className="form-error" role="alert">{error}</p>}
        </>
      )}
      {editing && (
        <PropertyForm
          customerId={customer.id}
          property={editing.id ? editing : null}
          onCancel={() => setEditing(null)}
          onSaved={(message, savedProperty) => {
            setEditing(null);
            onChanged(message, savedProperty);
            setSearch(savedProperty.addressLine1);
            setPage(0);
            resource.reload();
          }}
        />
      )}
    </Modal>
  );
}

function PropertyForm({ customerId, property, onCancel, onSaved }) {
  const [form, setForm] = useState({
    label: property?.label || "Primary",
    addressLine1: property?.addressLine1 || "",
    addressLine2: property?.addressLine2 || "",
    city: property?.city || "Charlotte",
    state: property?.state || "NC",
    postalCode: property?.postalCode || "",
    squareFeet: property?.squareFeet || "",
    condition: property?.condition || "",
    recentlyServiced: property?.recentlyServiced === null || property?.recentlyServiced === undefined
      ? ""
      : String(property.recentlyServiced),
    pets: property?.pets || "",
    accessInstructions: property?.accessInstructions || "",
    serviceNotes: property?.serviceNotes || "",
    active: property?.active ?? true
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      ...form,
      customerId,
      squareFeet: form.squareFeet ? Number(form.squareFeet) : null,
      condition: form.condition.trim() || null,
      recentlyServiced: form.recentlyServiced === "" ? null : form.recentlyServiced === "true"
    };
    try {
      const result = property
        ? await api.update("properties", property.id, payload)
        : await api.create("properties", payload);
      onSaved(property ? "Property updated." : "Property added.", result.property);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Label">
          <input required maxLength="100" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
        </Field>
        <Field label="Address">
          <input required maxLength="200" value={form.addressLine1} onChange={(event) => setForm({ ...form, addressLine1: event.target.value })} />
        </Field>
        <Field label="Unit or suite">
          <input maxLength="200" value={form.addressLine2} onChange={(event) => setForm({ ...form, addressLine2: event.target.value })} />
        </Field>
        <Field label="City">
          <input required maxLength="100" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
        </Field>
        <Field label="State">
          <input required maxLength="2" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} />
        </Field>
        <Field label="Postal code">
          <input required maxLength="20" value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} />
        </Field>
        <Field label="Square feet">
          <input min="1" step="1" type="number" value={form.squareFeet} onChange={(event) => setForm({ ...form, squareFeet: event.target.value })} />
        </Field>
        <Field label="Condition">
          <input maxLength="100" value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} />
        </Field>
        <Field label="Recently serviced">
          <select value={form.recentlyServiced} onChange={(event) => setForm({ ...form, recentlyServiced: event.target.value })}>
            <option value="">Unknown</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </Field>
        <Field label="Record status">
          <select value={String(form.active)} onChange={(event) => setForm({ ...form, active: event.target.value === "true" })}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </Field>
      </div>
      <Field label="Pets">
        <textarea rows="2" maxLength="1000" value={form.pets} onChange={(event) => setForm({ ...form, pets: event.target.value })} />
      </Field>
      <Field label="Access instructions">
        <textarea rows="3" maxLength="5000" value={form.accessInstructions} onChange={(event) => setForm({ ...form, accessInstructions: event.target.value })} />
      </Field>
      <Field label="Service notes">
        <textarea rows="3" maxLength="5000" value={form.serviceNotes} onChange={(event) => setForm({ ...form, serviceNotes: event.target.value })} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={property ? "Save changes" : "Add property"} />
    </form>
  );
}

function ConsentForm({ customer, onCancel, onSaved }) {
  const [status, setStatus] = useState("granted");
  const [source, setSource] = useState("Customer confirmed by text");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/customers/${customer.id}/text-consent`, { status, source });
      onSaved(`Text consent ${status} for ${customer.name}.`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Consent status">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="granted">Granted</option>
          <option value="revoked">Revoked</option>
        </select>
      </Field>
      <Field label="How consent was received">
        <input required maxLength="200" value={source} onChange={(event) => setSource(event.target.value)} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="Record consent" />
    </form>
  );
}

function PaymentsPage() {
  const [tab, setTab] = useState("ledger");
  const [date, setDate] = useState(localDate());
  const [decisionModal, setDecisionModal] = useState(null);
  const [tipModal, setTipModal] = useState(null);
  const [correctionModal, setCorrectionModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const ledger = useLoad(() => api.get("/payments/daily", { date }), [date]);
  const records = useLoad(
    () => ["payments", "credits"].includes(tab)
      ? api.get("/payments/records")
      : Promise.resolve({ payments: [], declined: [], credits: [] }),
    [tab]
  );
  const overview = useLoad(
    () => tab === "overview"
      ? api.get("/payments/overview")
      : Promise.resolve({ customers: [], totals: {} }),
    [tab]
  );
  const services = ledger.data?.services || [];
  const paymentRecords = records.data?.payments || [];
  const declinedRecords = records.data?.declined || [];
  const creditRecords = records.data?.credits || [];
  const customers = overview.data?.customers || [];

  function finishDecision(message) {
    setDecisionModal(null);
    setNotice({ message });
    ledger.reload();
    if (["payments", "credits"].includes(tab)) records.reload();
  }

  function finishCorrection(message) {
    setCorrectionModal(null);
    setNotice({ message });
    ledger.reload();
    records.reload();
    overview.reload();
  }

  function finishTip(message) {
    setTipModal(null);
    setNotice({ message });
    ledger.reload();
  }

  return (
    <>
      <PageHeader
        eyebrow="Daily receivables"
        title="Payments"
        description="Review scheduled services, confirm payment, and monitor customer balances."
      >
        <button className="secondary-button" type="button" onClick={() => {
          ledger.reload();
          if (["payments", "credits"].includes(tab)) records.reload();
          if (tab === "overview") overview.reload();
        }}>Refresh</button>
      </PageHeader>
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <section className="section-block payment-tabs">
        <div className="segmented-control" role="tablist" aria-label="Payment views">
          {[
            ["ledger", "Ledger"],
            ["payments", "Payments"],
            ["credits", "Credits"],
            ["overview", "Overview"]
          ].map(([value, label]) => (
            <button
              aria-selected={tab === value}
              className={tab === value ? "active" : ""}
              key={value}
              role="tab"
              type="button"
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {tab === "ledger" && (
        <section className="section-block" role="tabpanel">
          <div className="payment-ledger-heading">
            <SectionHeader
              eyebrow="Scheduled services"
              title={date === localDate() ? "Current work day" : shortDate(date)}
              count={ledger.status === "ready" ? services.length : undefined}
            />
            <Field label="Work day">
              <input className="date-control" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
          </div>
          {ledger.status === "loading" && <LoadingRows />}
          {ledger.status === "error" && <StatePanel title="Daily ledger unavailable" message={ledger.error} action={<button className="text-button" onClick={ledger.reload}>Try again</button>} />}
          {ledger.status === "ready" && services.length === 0 && <StatePanel title="No scheduled services" message="No clients are scheduled for this work day." />}
          {ledger.status === "ready" && services.length > 0 && (
            <div className="data-table daily-ledger-table">
              <div className="data-row data-head">
                <span>Date</span><span>Client information</span><span>Service</span><span>Amount charged</span><span>Tip</span><span>Paid</span>
              </div>
              {services.map((service) => (
                <article className="data-row" key={service.bookingId}>
                  <div data-label="Date">{shortDate(service.date)}</div>
                  <div data-label="Client information">
                    <strong>{service.customerName}</strong>
                    <small>{service.address}</small>
                    <small>{[service.customerPhone, service.customerEmail].filter(Boolean).join(" | ")}</small>
                  </div>
                  <div data-label="Service">
                    <strong>{service.serviceName || "Regular cleaning"}</strong>
                    <small>{service.billingType === "hourly" ? `${money(service.billingRateCents)} per hour` : "Flat rate"}</small>
                  </div>
                  <div data-label="Amount charged">
                    <strong>{money(service.amountCents ?? service.flatAmountCents)}</strong>
                    {service.billingType === "hourly" && <small>{service.hourlyMinutes ? hours(service.hourlyMinutes) : "Hours required"}</small>}
                  </div>
                  <div data-label="Tip">
                    <strong>{service.tipAmountCents == null ? "-" : money(service.tipAmountCents)}</strong>
                    <button className="text-button" type="button" onClick={() => setTipModal(service)}>
                      {service.tipId ? "Edit tip" : "Record tip"}
                    </button>
                  </div>
                  <div className="payment-decision-cell" data-label="Paid">
                    {service.decision ? (
                      <>
                        <StatusBadge status={service.decision === "approved" ? "paid" : "unpaid"} />
                        {service.paymentMethod && <small>{paymentMethodLabel(service.paymentMethod)}</small>}
                      </>
                    ) : (
                      <div className="row-actions">
                        <button className="primary-button compact-button" type="button" onClick={() => setDecisionModal({ service, decision: "approved" })}>Approve</button>
                        <button className="secondary-button compact-button" type="button" onClick={() => setDecisionModal({ service, decision: "declined" })}>Decline</button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "payments" && (
        <section className="section-block" role="tabpanel">
          <SectionHeader eyebrow="Confirmed receipts" title="Payments" count={records.status === "ready" ? paymentRecords.length : undefined} />
          {records.status === "loading" && <LoadingRows />}
          {records.status === "error" && <StatePanel title="Payment records unavailable" message={records.error} />}
          {records.status === "ready" && paymentRecords.length === 0 && <StatePanel title="No confirmed payments" message="Approved daily ledger entries will be stored here." />}
          {records.status === "ready" && paymentRecords.length > 0 && (
            <PaymentRecordTable
              rows={paymentRecords}
              onReverse={(record) => setCorrectionModal({ type: "reverse", record })}
            />
          )}
        </section>
      )}

      {tab === "credits" && (
        <>
          <section className="section-block" role="tabpanel">
            <SectionHeader eyebrow="Outstanding services" title="Payment declined" count={records.status === "ready" ? declinedRecords.length : undefined} />
            {records.status === "loading" && <LoadingRows />}
            {records.status === "error" && <StatePanel title="Credit records unavailable" message={records.error} />}
            {records.status === "ready" && declinedRecords.length === 0 && <StatePanel title="No outstanding services" message="Services marked unpaid will appear here." />}
            {records.status === "ready" && declinedRecords.length > 0 && (
              <PaymentRecordTable
                rows={declinedRecords}
                outstanding
                onWaive={(record) => setCorrectionModal({ type: "waive", record })}
              />
            )}
          </section>
          <section className="section-block">
            <SectionHeader eyebrow="Customer accounts" title="Positive credits" count={records.status === "ready" ? creditRecords.length : undefined} />
            {records.status === "ready" && creditRecords.length === 0 && <StatePanel title="No account credits" message="Customer overpayments and available credits will appear here." />}
            {records.status === "ready" && creditRecords.length > 0 && (
              <div className="data-table account-credit-table">
                <div className="data-row data-head"><span>Customer</span><span>Credit</span><span>Reason</span><span>Recorded</span></div>
                {creditRecords.map((credit, index) => (
                  <article className="data-row" key={credit.id || `${credit.customerId}-${index}`}>
                    <div data-label="Customer"><strong>{credit.customerName}</strong><small>{credit.phone}</small></div>
                    <div data-label="Credit"><strong>{money(credit.remainingCents ?? credit.creditCents ?? credit.amountCents)}</strong></div>
                    <div data-label="Reason">{credit.reason || "Account credit"}</div>
                    <div data-label="Recorded">{shortDate(credit.createdAt || credit.date)}</div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {tab === "overview" && (
        <section className="section-block" role="tabpanel">
          <div className="metric-grid report-metrics">
            <Metric label="Charged" value={money(overview.data?.totals?.chargedCents)} />
            <Metric label="Paid" value={money(overview.data?.totals?.paidCents)} />
            <Metric label="Outstanding" value={money(overview.data?.totals?.outstandingCents)} warning={Number(overview.data?.totals?.outstandingCents) > 0} />
            <Metric label="Account credits" value={money(overview.data?.totals?.creditCents)} />
          </div>
          <SectionHeader eyebrow="Account standing" title="Customer overview" count={overview.status === "ready" ? customers.length : undefined} />
          {overview.status === "loading" && <LoadingRows />}
          {overview.status === "error" && <StatePanel title="Payment overview unavailable" message={overview.error} />}
          {overview.status === "ready" && customers.length === 0 && <StatePanel title="No customer balances" message="Customer financial standing will appear after services are charged." />}
          {overview.status === "ready" && customers.length > 0 && (
            <div className="data-table payment-overview-table">
              <div className="data-row data-head"><span>Customer</span><span>Charged</span><span>Paid</span><span>Outstanding</span><span>Credit</span><span>Standing</span></div>
              {customers.map((customer) => (
                <article className="data-row" key={customer.customerId}>
                  <div data-label="Customer"><strong>{customer.customerName}</strong><small>{customer.phone}</small></div>
                  <div data-label="Charged">{money(customer.chargedCents)}</div>
                  <div data-label="Paid">{money(customer.paidCents)}</div>
                  <div data-label="Outstanding">{money(customer.outstandingCents)}</div>
                  <div data-label="Credit">{money(customer.creditCents)}</div>
                  <div data-label="Standing"><StatusBadge status={customer.standing === "good" ? "good standing" : customer.standing} /></div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {decisionModal && (
        <Modal
          title={decisionModal.decision === "approved" ? "Approve payment" : "Decline payment"}
          description={`${decisionModal.service.customerName} - ${decisionModal.service.serviceName || "Cleaning service"}`}
          onClose={() => setDecisionModal(null)}
        >
          <PaymentDecisionForm
            decision={decisionModal.decision}
            service={decisionModal.service}
            onCancel={() => setDecisionModal(null)}
            onSaved={() => finishDecision(decisionModal.decision === "approved" ? "Payment approved and recorded." : "Service marked as outstanding.")}
          />
        </Modal>
      )}
      {tipModal && (
        <Modal
          title={tipModal.tipId ? "Edit service tip" : "Record service tip"}
          description={`${tipModal.customerName} - ${tipModal.serviceName || "Cleaning service"}`}
          onClose={() => setTipModal(null)}
        >
          <ServiceTipForm
            service={tipModal}
            onCancel={() => setTipModal(null)}
            onSaved={() => finishTip(tipModal.tipId ? "Service tip updated." : "Service tip recorded and split across the assigned cleaners.")}
          />
        </Modal>
      )}
      {correctionModal?.type === "reverse" && (
        <Modal title="Reverse payment" description={`${correctionModal.record.customerName} - ${money(correctionModal.record.amountCents)}`} onClose={() => setCorrectionModal(null)}>
          <FinancialCorrectionForm
            path={`/payments/${correctionModal.record.id}/reverse`}
            onCancel={() => setCorrectionModal(null)}
            onSaved={() => finishCorrection("Payment reversed and customer balance updated.")}
            submitLabel="Reverse payment"
          />
        </Modal>
      )}
      {correctionModal?.type === "waive" && (
        <Modal title="Waive charge" description={`${correctionModal.record.customerName} - ${money(correctionModal.record.amountCents)}`} onClose={() => setCorrectionModal(null)}>
          <FinancialCorrectionForm
            path={`/charges/${correctionModal.record.id}/waive`}
            onCancel={() => setCorrectionModal(null)}
            onSaved={() => finishCorrection("Charge waived and customer balance updated.")}
            submitLabel="Waive charge"
          />
        </Modal>
      )}
    </>
  );
}

function PaymentRecordTable({ rows, outstanding = false, onReverse, onWaive }) {
  return (
    <div className="data-table payment-record-table">
      <div className="data-row data-head"><span>Date</span><span>Customer</span><span>Service</span><span>Amount</span><span>{outstanding ? "Status" : "Method"}</span><span>Actions</span></div>
      {rows.map((row, index) => (
        <article className="data-row" key={row.id || row.bookingId || `${row.customerId}-${row.date}-${index}`}>
          <div data-label="Date">{shortDate(row.date || row.serviceDate || row.chargedOn || row.paidAt)}</div>
          <div data-label="Customer"><strong>{row.customerName}</strong><small>{row.customerPhone || row.phone}</small></div>
          <div data-label="Service"><strong>{row.serviceName || row.description}</strong><small>{row.address}</small></div>
          <div data-label="Amount"><strong>{money(row.amountCents)}</strong></div>
          <div data-label={outstanding ? "Status" : "Method"}>
            {outstanding
              ? <StatusBadge status="past due" />
              : row.status === "reversed"
                ? <StatusBadge status="reversed" />
                : paymentMethodLabel(row.paymentMethod || row.method)}
            {row.reversalReason && <small>{row.reversalReason}</small>}
          </div>
          <div className="row-actions" data-label="Actions">
            {outstanding && onWaive && (
              <button className="text-button danger-text" type="button" onClick={() => onWaive(row)}>Waive</button>
            )}
            {!outstanding && row.status !== "reversed" && onReverse && (
              <button className="text-button danger-text" type="button" onClick={() => onReverse(row)}>Reverse</button>
            )}
            {!outstanding && row.status === "reversed" && <span className="muted">Corrected</span>}
          </div>
        </article>
      ))}
    </div>
  );
}

function FinancialCorrectionForm({ path, onCancel, onSaved, submitLabel }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(path, { reason });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Reason">
        <textarea required maxLength="1000" rows="3" value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions danger saving={saving} onCancel={onCancel} submitLabel={submitLabel} />
    </form>
  );
}

function ServiceTipForm({ service, onCancel, onSaved }) {
  const [amount, setAmount] = useState(
    service.tipAmountCents == null ? "" : (Number(service.tipAmountCents) / 100).toFixed(2)
  );
  const [source, setSource] = useState(service.tipSource || "customer");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { amountCents: cents(amount), source };
      if (service.tipId) {
        await api.patch(`/bookings/${service.bookingId}/tips/${service.tipId}`, payload);
      } else {
        await api.post(`/bookings/${service.bookingId}/tips`, payload);
      }
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Tip amount">
        <input required min="0.01" step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <Field label="Reported by">
        <select value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="customer">Customer</option>
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
        </select>
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={service.tipId ? "Save tip" : "Record tip"} />
    </form>
  );
}

function PaymentDecisionForm({ decision, service, onCancel, onSaved }) {
  const [hourlyHours, setHourlyHours] = useState(service.hourlyMinutes ? String(service.hourlyMinutes / 60) : "");
  const [paymentMethod, setPaymentMethod] = useState(service.paymentMethod || "zelle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isHourly = service.billingType === "hourly";
  const hourlyMinutes = isHourly ? Math.round(Number(hourlyHours || 0) * 60) : undefined;
  const amountCents = isHourly
    ? Math.round(Number(service.billingRateCents || 0) * Number(hourlyMinutes || 0) / 60)
    : service.amountCents ?? service.flatAmountCents;

  async function submit(event) {
    event.preventDefault();
    if (isHourly && hourlyMinutes <= 0) {
      setError("Enter the hours worked before recording this service.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post(`/payments/daily/${service.bookingId}/decision`, {
        decision,
        ...(isHourly ? { hourlyMinutes } : {}),
        ...(decision === "approved" ? { paymentMethod } : {})
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="decision-summary">
        <span>Service amount</span>
        <strong>{money(amountCents)}</strong>
      </div>
      {isHourly && (
        <Field label="Total service hours" hint={`Calculated at ${money(service.billingRateCents)} per hour`}>
          <input required min="0.25" step="0.25" type="number" value={hourlyHours} onChange={(event) => setHourlyHours(event.target.value)} />
        </Field>
      )}
      {decision === "approved" && (
        <Field label="Payment method">
          <select required value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
            <option value="zelle">Zelle</option>
            <option value="venmo">Venmo</option>
            <option value="paypal">PayPal</option>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
          </select>
        </Field>
      )}
      {decision === "declined" && <p className="form-note">This service will be stored as an outstanding customer balance.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions
        saving={saving}
        onCancel={onCancel}
        submitLabel={decision === "approved" ? "Approve payment" : "Mark outstanding"}
      />
    </form>
  );
}

function ChargeForm({ customerId, onCancel, onSaved }) {
  const [form, setForm] = useState({ type: "service", description: "", amount: "", chargedOn: localDate() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/customers/${customerId}/charges`, {
        type: form.type,
        description: form.description,
        amountCents: cents(form.amount),
        chargedOn: form.chargedOn
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Charge type">
          <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            <option value="service">Service</option><option value="additional_work">Additional work</option><option value="cancellation_fee">Cancellation fee</option>
          </select>
        </Field>
        <Field label="Charged on"><input required type="date" value={form.chargedOn} onChange={(event) => setForm({ ...form, chargedOn: event.target.value })} /></Field>
        <Field label="Amount"><input required min="0" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field>
      </div>
      <Field label="Description"><input required maxLength="500" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="Add charge" />
    </form>
  );
}

function PaymentForm({ customerId, onCancel, onSaved }) {
  const [form, setForm] = useState({ method: "zelle", amount: "", paidAt: localDateTime(new Date()), reference: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/customers/${customerId}/payments`, {
        method: form.method,
        amountCents: cents(form.amount),
        paidAt: new Date(form.paidAt).toISOString(),
        reference: form.reference
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Method">
          <select value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}>
            <option value="zelle">Zelle</option><option value="venmo">Venmo</option><option value="paypal">PayPal</option><option value="cash">Cash</option><option value="check">Check</option>
          </select>
        </Field>
        <Field label="Amount"><input required min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field>
        <Field label="Paid at"><input required type="datetime-local" value={form.paidAt} onChange={(event) => setForm({ ...form, paidAt: event.target.value })} /></Field>
        <Field label="Reference"><input maxLength="200" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></Field>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="Record payment" />
    </form>
  );
}

function EmployeesPage() {
  const [tab, setTab] = useState("employees");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeePage, setEmployeePage] = useState(0);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const debouncedEmployeeSearch = useDebouncedValue(employeeSearch);
  const resource = useLoad(async () => {
    const [employeeData, activeEmployeeData, teamData, availabilityData] = await Promise.all([
      api.list("employees", {
        q: debouncedEmployeeSearch,
        limit: PAGE_SIZE,
        offset: employeePage * PAGE_SIZE
      }),
      api.list("employees", { active: true, limit: 100 }),
      api.list("teams", { limit: 100 }),
      api.list("availability-exceptions", { limit: 100 })
    ]);
    return {
      employees: employeeData.employees || [],
      employeeOptions: activeEmployeeData.employees || [],
      teams: teamData.teams || [],
      availability: availabilityData.availabilityExceptions || [],
      pagination: employeeData.pagination
    };
  }, [debouncedEmployeeSearch, employeePage]);
  const data = resource.data || {
    employees: [],
    employeeOptions: [],
    teams: [],
    availability: [],
    pagination: null
  };

  async function exportEmployees() {
    try {
      const rows = await loadAllRows("/employees", {
        q: debouncedEmployeeSearch
      }, "employees");
      downloadTableCsv({
        filename: "queen-city-maid-employees.csv",
        columns: [
          "First name", "Last name", "Phone", "Hire date", "Hourly rate",
          "Experience", "Driver", "Active", "Quality rating"
        ],
        rows: rows.map((employee) => [
          employee.firstName, employee.lastName, employee.phone, employee.hireDate,
          (Number(employee.hourlyRateCents || 0) / 100).toFixed(2),
          employee.experienceLevel, employee.canDrive ? "Yes" : "No",
          employee.active ? "Yes" : "No", employee.qualityRating
        ])
      });
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="People and crews"
        title="Employees"
        description="Cleaner records, regular teams, captains, and availability exceptions."
      >
        {tab === "employees" && (
          <button className="secondary-button" type="button" onClick={exportEmployees}>
            Export filtered CSV
          </button>
        )}
        <button
          className="primary-button inline-button"
          type="button"
          onClick={() => setModal({ type: tab === "teams" ? "team" : tab === "availability" ? "availability" : "employee" })}
        >
          {tab === "teams" ? "Add team" : tab === "availability" ? "Add availability" : "Add employee"}
        </button>
      </PageHeader>
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <section className="section-block">
        <div className="segmented-control" aria-label="Employee views">
          {[
            ["employees", "Employees"],
            ["teams", "Teams"],
            ["availability", "Availability"]
          ].map(([value, label]) => (
            <button
              aria-pressed={tab === value}
              className={tab === value ? "active" : ""}
              key={value}
              type="button"
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "employees" && (
          <div className="toolbar">
            <input
              aria-label="Search employees"
              className="search-input"
              placeholder="Search name or phone"
              type="search"
              value={employeeSearch}
              onChange={(event) => {
                setEmployeeSearch(event.target.value);
                setEmployeePage(0);
              }}
            />
          </div>
        )}

        {resource.status === "loading" && <LoadingRows />}
        {resource.status === "error" && (
          <StatePanel title="Employee records unavailable" message={resource.error} action={<button className="text-button" onClick={resource.reload}>Try again</button>} />
        )}
        {resource.status === "ready" && tab === "employees" && (
          <>
            <EmployeeList
              employees={data.employees}
              onEdit={(item) => setModal({ type: "employee", item })}
              onFeedback={(item) => setModal({ type: "feedback", item })}
            />
            <Pagination pagination={data.pagination} onPageChange={setEmployeePage} />
          </>
        )}
        {resource.status === "ready" && tab === "teams" && (
          <TeamList
            teams={data.teams}
            onEdit={(item) => setModal({ type: "team", item })}
            onMembers={(item) => setModal({ type: "members", item })}
          />
        )}
        {resource.status === "ready" && tab === "availability" && (
          <AvailabilityList
            availability={data.availability}
            employees={data.employeeOptions}
            onEdit={(item) => setModal({ type: "availability", item })}
          />
        )}
      </section>

      {modal?.type === "employee" && (
        <Modal title={modal.item ? "Edit employee" : "Add employee"} onClose={() => setModal(null)}>
          <EmployeeForm
            employee={modal.item}
            onCancel={() => setModal(null)}
            onSaved={(message) => finishModal(message, setModal, setNotice, resource.reload)}
          />
        </Modal>
      )}
      {modal?.type === "team" && (
        <Modal title={modal.item ? "Edit team" : "Add team"} onClose={() => setModal(null)}>
          <TeamForm
            team={modal.item}
            onCancel={() => setModal(null)}
            onSaved={(message) => finishModal(message, setModal, setNotice, resource.reload)}
          />
        </Modal>
      )}
      {modal?.type === "availability" && (
        <Modal title={modal.item ? "Edit availability" : "Add availability"} onClose={() => setModal(null)}>
          <AvailabilityForm
            item={modal.item}
            employees={data.employeeOptions}
            onCancel={() => setModal(null)}
            onSaved={(message) => finishModal(message, setModal, setNotice, resource.reload)}
          />
        </Modal>
      )}
      {modal?.type === "members" && (
        <MemberManager
          team={modal.item}
          employees={data.employeeOptions}
          onClose={() => setModal(null)}
          onNotice={setNotice}
        />
      )}
      {modal?.type === "feedback" && (
        <QualityFeedbackManager
          employee={modal.item}
          onClose={() => setModal(null)}
          onChanged={(message) => {
            setNotice({ message });
            resource.reload();
          }}
        />
      )}
    </>
  );
}

function EmployeeList({ employees, onEdit, onFeedback }) {
  if (!employees.length) return <StatePanel title="No employees" message="Add the first cleaner record." />;
  return (
    <div className="data-table employee-table">
      <div className="data-row data-head"><span>Employee</span><span>Experience</span><span>Rate</span><span>Driver</span><span>Status</span><span>Actions</span></div>
      {employees.map((employee) => (
        <article className="data-row" key={employee.id}>
          <div data-label="Employee"><strong>{employee.firstName} {employee.lastName}</strong><small>{employee.phone}</small></div>
          <div data-label="Experience"><span>{capitalize(employee.experienceLevel)}</span><small>{employee.qualityRating ? `${Number(employee.qualityRating).toFixed(1)} quality rating` : "No rating"}</small></div>
          <div data-label="Rate">{money(employee.hourlyRateCents)}/hr</div>
          <div data-label="Driver">{employee.canDrive ? "Yes" : "No"}</div>
          <div data-label="Status"><StatusBadge status={employee.active ? "active" : "inactive"} /></div>
          <div className="row-actions" data-label="Actions">
            <button className="text-button" type="button" onClick={() => onFeedback(employee)}>Feedback</button>
            <button className="text-button" type="button" onClick={() => onEdit(employee)}>Edit</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function QualityFeedbackManager({ employee, onClose, onChanged }) {
  const resource = useLoad(() => api.list("quality-feedback", {
    employeeId: employee.id,
    limit: 100
  }), [employee.id]);
  const [form, setForm] = useState({
    rating: "5",
    notes: "",
    receivedAt: localDate()
  });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const feedback = resource.data?.qualityFeedback || [];

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.create("quality-feedback", {
        employeeId: employee.id,
        rating: Number(form.rating),
        notes: form.notes,
        receivedAt: form.receivedAt
      });
      setForm((current) => ({ ...current, notes: "" }));
      onChanged("Employee feedback recorded.");
      resource.reload();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function remove(item) {
    if (!window.confirm("Delete this feedback entry?")) return;
    setDeletingId(item.id);
    setError("");
    try {
      await api.remove(`/quality-feedback/${item.id}`);
      onChanged("Employee feedback deleted.");
      resource.reload();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setDeletingId("");
    }
  }

  return (
    <Modal title={`${employee.firstName} ${employee.lastName} - Feedback`} onClose={onClose}>
      {resource.status === "loading" && <LoadingRows />}
      {resource.status === "error" && <StatePanel title="Feedback unavailable" message={resource.error} />}
      {resource.status === "ready" && (
        <>
          <div className="stack-list compact-list">
            {!feedback.length && <StatePanel title="No feedback" message="Record the first client or manager rating." />}
            {feedback.map((item) => (
              <article className="stack-row" key={item.id}>
                <div>
                  <strong>{item.rating} of 5</strong>
                  <p>{item.notes || "No notes"}</p>
                  <small>{dateTime(item.receivedAt)}</small>
                </div>
                <button
                  className="text-button danger-text"
                  disabled={deletingId === item.id}
                  type="button"
                  onClick={() => remove(item)}
                >
                  {deletingId === item.id ? "Deleting..." : "Delete"}
                </button>
              </article>
            ))}
          </div>
          <form className="modal-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Rating">
                <select value={form.rating} onChange={(event) => setForm({ ...form, rating: event.target.value })}>
                  <option value="5">5 - Excellent</option><option value="4">4 - Good</option>
                  <option value="3">3 - Satisfactory</option><option value="2">2 - Needs improvement</option>
                  <option value="1">1 - Poor</option>
                </select>
              </Field>
              <Field label="Received at">
                <input required type="date" value={form.receivedAt} onChange={(event) => setForm({ ...form, receivedAt: event.target.value })} />
              </Field>
            </div>
            <Field label="Feedback notes">
              <textarea maxLength="2000" rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button inline-button" disabled={saving} type="submit">
              {saving ? "Recording..." : "Record feedback"}
            </button>
          </form>
        </>
      )}
    </Modal>
  );
}

function EmployeeForm({ employee, onCancel, onSaved }) {
  const [form, setForm] = useState({
    firstName: employee?.firstName || "",
    lastName: employee?.lastName || "",
    phone: employee?.phone || "",
    hireDate: employee?.hireDate?.slice(0, 10) || "",
    hourlyRate: employee ? (employee.hourlyRateCents / 100).toFixed(2) : "",
    experienceLevel: employee?.experienceLevel || "standard",
    canDrive: employee?.canDrive || false,
    active: employee?.active ?? true
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      hireDate: form.hireDate || null,
      hourlyRateCents: cents(form.hourlyRate),
      experienceLevel: form.experienceLevel,
      canDrive: form.canDrive,
      active: form.active
    };
    try {
      if (employee) await api.update("employees", employee.id, payload);
      else await api.create("employees", payload);
      onSaved(employee ? "Employee updated." : "Employee added.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="First name"><input required maxLength="100" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></Field>
        <Field label="Last name"><input required maxLength="100" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></Field>
        <Field label="Phone"><input required maxLength="30" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
        <Field label="Hire date"><input type="date" value={form.hireDate} onChange={(event) => setForm({ ...form, hireDate: event.target.value })} /></Field>
        <Field label="Hourly rate"><input required min="0" step="0.01" type="number" value={form.hourlyRate} onChange={(event) => setForm({ ...form, hourlyRate: event.target.value })} /></Field>
        <Field label="Experience level">
          <select value={form.experienceLevel} onChange={(event) => setForm({ ...form, experienceLevel: event.target.value })}>
            <option value="new">New</option><option value="standard">Standard</option><option value="senior">Senior</option>
          </select>
        </Field>
        <Field label="Can drive">
          <select value={String(form.canDrive)} onChange={(event) => setForm({ ...form, canDrive: event.target.value === "true" })}>
            <option value="false">No</option><option value="true">Yes</option>
          </select>
        </Field>
        <Field label="Status">
          <select value={String(form.active)} onChange={(event) => setForm({ ...form, active: event.target.value === "true" })}>
            <option value="true">Active</option><option value="false">Inactive</option>
          </select>
        </Field>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={employee ? "Save changes" : "Add employee"} />
    </form>
  );
}

function TeamList({ teams, onEdit, onMembers }) {
  if (!teams.length) return <StatePanel title="No teams" message="Create a regular two-person crew." />;
  return (
    <div className="stack-list">
      {teams.map((team) => (
        <article className="stack-row" key={team.id}>
          <div><strong>{team.name}</strong><p><StatusBadge status={team.active ? "active" : "inactive"} /></p></div>
          <div className="row-actions">
            <button className="text-button" type="button" onClick={() => onMembers(team)}>Members</button>
            <button className="text-button" type="button" onClick={() => onEdit(team)}>Edit</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function TeamForm({ team, onCancel, onSaved }) {
  const [name, setName] = useState(team?.name || "");
  const [active, setActive] = useState(team?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (team) await api.update("teams", team.id, { name, active });
      else await api.create("teams", { name, active });
      onSaved(team ? "Team updated." : "Team added.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Team name"><input required maxLength="100" value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="Status">
        <select value={String(active)} onChange={(event) => setActive(event.target.value === "true")}>
          <option value="true">Active</option><option value="false">Inactive</option>
        </select>
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={team ? "Save changes" : "Add team"} />
    </form>
  );
}

function MemberManager({ team, employees, onClose, onNotice }) {
  const resource = useLoad(() => api.get(`/teams/${team.id}/members`), [team.id]);
  const [employeeId, setEmployeeId] = useState("");
  const [isCaptain, setIsCaptain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const members = resource.data?.teamMembers || [];

  async function add(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/teams/${team.id}/members`, {
        employeeId,
        isCaptain,
        effectiveFrom: localDate()
      });
      setEmployeeId("");
      setIsCaptain(false);
      onNotice({ message: "Team member added." });
      resource.reload();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function updateCaptain(member) {
    try {
      await api.patch(`/teams/${team.id}/members/${member.employeeId}/${member.effectiveFrom.slice(0, 10)}`, {
        isCaptain: !member.isCaptain
      });
      onNotice({ message: "Team role updated." });
      resource.reload();
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  async function remove(member) {
    try {
      await api.remove(`/teams/${team.id}/members/${member.employeeId}/${member.effectiveFrom.slice(0, 10)}`);
      onNotice({ message: "Team member removed." });
      resource.reload();
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  return (
    <Modal title={`${team.name} - Members`} onClose={onClose}>
      {resource.status === "loading" && <LoadingRows />}
      {resource.status === "error" && <StatePanel title="Members unavailable" message={resource.error} />}
      {resource.status === "ready" && (
        <>
          <div className="stack-list compact-list">
            {members.length === 0 && <StatePanel title="No members" message="Add cleaners to this team." />}
            {members.map((member) => (
              <article className="stack-row" key={`${member.employeeId}-${member.effectiveFrom}`}>
                <div>
                  <strong>{member.firstName} {member.lastName}</strong>
                  <p>{member.isCaptain ? "Captain and driver" : "Cleaner"}</p>
                </div>
                <div className="row-actions">
                  <button className="text-button" type="button" onClick={() => updateCaptain(member)}>
                    {member.isCaptain ? "Remove captain role" : "Make captain"}
                  </button>
                  <button className="text-button danger-text" type="button" onClick={() => remove(member)}>Remove</button>
                </div>
              </article>
            ))}
          </div>
          <form className="inline-form" onSubmit={add}>
            <Field label="Employee">
              <select required value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                <option value="">Select employee</option>
                {employees.filter((employee) => employee.active).map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>
                ))}
              </select>
            </Field>
            <label className="checkbox-field">
              <input checked={isCaptain} type="checkbox" onChange={(event) => setIsCaptain(event.target.checked)} />
              Captain
            </label>
            <button className="primary-button inline-button" disabled={saving} type="submit">
              {saving ? "Adding..." : "Add member"}
            </button>
          </form>
          {error && <p className="form-error" role="alert">{error}</p>}
        </>
      )}
    </Modal>
  );
}

function AvailabilityList({ availability, employees, onEdit }) {
  const employeeName = (id) => {
    const employee = employees.find((item) => item.id === id);
    return employee ? `${employee.firstName} ${employee.lastName}` : "Employee";
  };
  if (!availability.length) return <StatePanel title="No availability exceptions" message="All active employees are currently considered available." />;
  return (
    <div className="data-table availability-table">
      <div className="data-row data-head"><span>Employee</span><span>Start</span><span>End</span><span>Reason</span><span>Status</span><span>Actions</span></div>
      {availability.map((item) => (
        <article className="data-row" key={item.id}>
          <div data-label="Employee"><strong>{employeeName(item.employeeId)}</strong></div>
          <div data-label="Start">{dateTime(item.startsAt)}</div>
          <div data-label="End">{dateTime(item.endsAt)}</div>
          <div data-label="Reason">{item.reason}</div>
          <div data-label="Status"><StatusBadge status={item.status} /></div>
          <div data-label="Actions"><button className="text-button" type="button" onClick={() => onEdit(item)}>Review</button></div>
        </article>
      ))}
    </div>
  );
}

function AvailabilityForm({ item, employees, onCancel, onSaved }) {
  const [form, setForm] = useState({
    employeeId: item?.employeeId || "",
    startsAt: localDateTime(item?.startsAt),
    endsAt: localDateTime(item?.endsAt),
    reason: item?.reason || "",
    status: item?.status || "requested"
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      employeeId: form.employeeId,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      reason: form.reason,
      status: form.status
    };
    try {
      if (item) await api.update("availability-exceptions", item.id, payload);
      else await api.create("availability-exceptions", payload);
      onSaved(item ? "Availability updated." : "Availability added.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Employee">
        <select required value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })}>
          <option value="">Select employee</option>
          {employees.filter((employee) => employee.active).map((employee) => (
            <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="Unavailable from"><input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></Field>
        <Field label="Unavailable until"><input required type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></Field>
      </div>
      <Field label="Reason"><textarea required rows="3" maxLength="1000" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field>
      <Field label="Status">
        <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
          <option value="requested">Requested</option><option value="approved">Approved</option><option value="declined">Declined</option>
        </select>
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={item ? "Save decision" : "Add availability"} />
    </form>
  );
}

function SchedulePage() {
  const [tab, setTab] = useState("A");
  const [reference, setReference] = useState(localDate());
  const [dayIndex, setDayIndex] = useState(0);
  const [teamId, setTeamId] = useState("");
  const [historyFrom, setHistoryFrom] = useState(shiftDate(localDate(), -90));
  const [historyTo, setHistoryTo] = useState(localDate());
  const [issueStatus, setIssueStatus] = useState("open");
  const [planStatus, setPlanStatus] = useState("");
  const [revision, setRevision] = useState(0);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const referenceData = useLoad(async () => {
    const [serviceData, teamData] = await Promise.all([
      api.list("service-types", { active: true, limit: 100 }),
      api.list("teams", { active: true, limit: 100 })
    ]);
    return {
      serviceTypes: serviceData.serviceTypes || [],
      teams: teamData.teams || []
    };
  }, []);
  const resource = useLoad(async () => {
    if (tab === "A" || tab === "B") {
      await api.post("/schedule-planner/sync", { reference });
      return api.get("/schedule-planner", { week: tab, reference });
    }
    if (tab === "others") {
      return api.get("/schedule-planner/others", { reference });
    }
    if (tab === "issues") {
      return api.get("/job-issues", { status: issueStatus, limit: 100 });
    }
    if (tab === "plans") {
      return api.get("/recurring-services", { status: planStatus, limit: 100 });
    }
    return api.get("/schedule-planner/history", {
      from: historyFrom,
      to: historyTo,
      limit: 300
    });
  }, [tab, reference, historyFrom, historyTo, issueStatus, planStatus, revision]);

  const plan = tab === "A" || tab === "B" ? resource.data : null;
  const selectedDay = plan?.days?.[dayIndex] || plan?.days?.[0];
  const teams = plan?.teams || referenceData.data?.teams || [];
  const hasUnassigned = Boolean(selectedDay?.bookings?.some((booking) => !booking.teamId));

  useEffect(() => {
    if (!plan?.days?.length) return;
    const todayIndex = plan.days.findIndex((day) => day.date === localDate());
    setDayIndex(todayIndex >= 0 ? todayIndex : 0);
    setTeamId("");
  }, [tab, reference, plan?.weekStart, plan?.weekEnd]);

  useEffect(() => {
    if (!plan?.teams?.length || teamId) return;
    setTeamId(plan.teams[0].id);
  }, [plan, teamId]);

  function changed(message) {
    setModal(null);
    setNotice({ message });
    setRevision((value) => value + 1);
  }

  async function finalizeRoute(routeId) {
    try {
      await api.post(`/routes/${routeId}/finalize`);
      changed("Crew route finalized and ready for the captain.");
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  async function unassignBooking(booking) {
    if (!window.confirm(`Remove ${booking.customerName} from this crew? The visit will stay scheduled.`)) return;
    try {
      await api.post(`/schedule-planner/bookings/${booking.id}/move`, {
        date: booking.serviceDate,
        startTime: booking.startTime,
        teamId: null,
        updateScope: "single"
      });
      changed("Visit unassigned and kept on the schedule.");
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  async function planAction(planItem, action) {
    const message = action === "paused"
      ? `Pause ${planItem.customerName}'s ${planItem.serviceName} plan? Future unstarted visits will be cancelled.`
      : `End ${planItem.customerName}'s ${planItem.serviceName} plan? This cannot be resumed automatically.`;
    if (!window.confirm(message)) return;
    try {
      await api.patch(`/recurring-services/${planItem.id}`, { status: action });
      changed(action === "paused" ? "Service plan paused." : "Service plan ended.");
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Weekly operations"
        title="Schedule"
        description="Alternating service weeks, crew routes, flexible recurring clients, and service history."
      >
        {(tab === "A" || tab === "B" || tab === "others" || tab === "plans") && (
          <button
            className="secondary-button"
            disabled={referenceData.status !== "ready"}
            type="button"
            onClick={() => setModal({ type: "recurring", date: selectedDay?.date || nextScheduleDate(reference) })}
          >
            Add recurring service
          </button>
        )}
        {(tab === "A" || tab === "B") && (
          <button
            className="primary-button inline-button"
            disabled={referenceData.status !== "ready"}
            type="button"
            onClick={() => setModal({
              type: "booking",
              date: selectedDay?.date,
              teamId: teamId === "unassigned" ? "" : teamId
            })}
          >
            Add booking
          </button>
        )}
      </PageHeader>
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <nav className="schedule-primary-tabs" aria-label="Schedule views">
        {[
          ["A", "Schedule A"],
          ["B", "Schedule B"],
          ["others", "Others"],
          ["plans", "Service plans"],
          ["history", "Past services"],
          ["issues", "Job issues"]
        ].map(([value, label]) => (
          <button
            aria-selected={tab === value}
            className={tab === value ? "active" : ""}
            key={value}
            role="tab"
            type="button"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {(tab === "A" || tab === "B") && (
        <section className="schedule-period-bar">
          <div>
            <p className="eyebrow">Schedule {tab}</p>
            <h2>{plan ? `${shortDate(plan.weekStart)} - ${shortDate(plan.weekEnd)}` : "Loading week"}</h2>
          </div>
          <div className="schedule-period-actions">
            <button className="secondary-button compact-button" type="button" onClick={() => setReference(shiftDate(reference, -14))}>Previous cycle</button>
            <button className="secondary-button compact-button" type="button" onClick={() => setReference(localDate())}>Current cycle</button>
            <button className="secondary-button compact-button" type="button" onClick={() => setReference(shiftDate(reference, 14))}>Next cycle</button>
          </div>
        </section>
      )}

      <section className="section-block schedule-workspace">
        {resource.status === "loading" && <LoadingRows />}
        {resource.status === "error" && (
          <StatePanel title="Schedule unavailable" message={resource.error} action={<button className="text-button" onClick={resource.reload}>Try again</button>} />
        )}
        {resource.status === "ready" && (tab === "A" || tab === "B") && (
          <WeeklySchedule
            dayIndex={dayIndex}
            hasUnassigned={hasUnassigned}
            plan={plan}
            selectedDay={selectedDay}
            teamId={teamId}
            onDayChange={setDayIndex}
            onCancelBooking={(booking) => setModal({ type: "cancel-booking", booking })}
            onDuplicate={(booking) => setModal({ type: "duplicate-booking", booking })}
            onEdit={(booking) => setModal({ type: "edit-booking", booking })}
            onFinalizeRoute={finalizeRoute}
            onPlaceFlexible={(service) => setModal({ type: "place", service })}
            onTeamChange={setTeamId}
            onUnassign={unassignBooking}
          />
        )}
        {resource.status === "ready" && tab === "others" && (
          <OtherServices
            reference={reference}
            services={resource.data?.services || []}
            onPlace={(service) => setModal({ type: "place", service })}
            onSetNextDate={(service) => setModal({ type: "next-service-date", service })}
            onReferenceChange={setReference}
          />
        )}
        {resource.status === "ready" && tab === "history" && (
          <ServiceHistory
            data={resource.data}
            from={historyFrom}
            to={historyTo}
            onFromChange={setHistoryFrom}
            onRestore={(service) => setModal({ type: "restore-booking", booking: service })}
            onToChange={setHistoryTo}
          />
        )}
        {resource.status === "ready" && tab === "plans" && (
          <RecurringPlans
            plans={resource.data?.recurringServices || []}
            status={planStatus}
            onEnd={(planItem) => planAction(planItem, "ended")}
            onPause={(planItem) => planAction(planItem, "paused")}
            onResume={(planItem) => setModal({ type: "resume-plan", plan: planItem })}
            onStatusChange={setPlanStatus}
          />
        )}
        {resource.status === "ready" && tab === "issues" && (
          <JobIssues
            issues={resource.data?.jobIssues || []}
            status={issueStatus}
            onResolve={(issue) => setModal({ type: "resolve-issue", issue })}
            onStatusChange={setIssueStatus}
          />
        )}
      </section>

      {modal?.type === "booking" && (
        <Modal title="Add booking" description="Add a client directly to a crew and time block." onClose={() => setModal(null)}>
          <PlannerBookingForm
            data={referenceData.data}
            initialDate={modal.date}
            initialTeamId={modal.teamId}
            onCancel={() => setModal(null)}
            onSaved={() => changed("Booking added to the schedule.")}
          />
        </Modal>
      )}
      {modal?.type === "duplicate-booking" && (
        <Modal
          title={`Duplicate visit - ${modal.booking.customerName}`}
          description="Review the copied details and choose an open crew and time block."
          onClose={() => setModal(null)}
        >
          <PlannerBookingForm
            data={referenceData.data}
            initialBooking={modal.booking}
            initialDate={modal.booking.serviceDate}
            initialTeamId={modal.booking.teamId}
            onCancel={() => setModal(null)}
            onSaved={() => changed("Booking duplicated on the schedule.")}
          />
        </Modal>
      )}
      {modal?.type === "recurring" && (
        <Modal title="Add recurring service" description="Set the client's permanent frequency, preferred crew, time, and billing." onClose={() => setModal(null)}>
          <RecurringServiceForm
            data={referenceData.data}
            initialDate={modal.date}
            onCancel={() => setModal(null)}
            onSaved={() => changed("Recurring service added.")}
          />
        </Modal>
      )}
      {modal?.type === "cancel-booking" && (
        <Modal
          title={`Cancel visit - ${modal.booking.customerName}`}
          description={`${shortDate(modal.booking.serviceDate)} at ${clock(modal.booking.scheduledStart)}. The recurring service will remain active.`}
          onClose={() => setModal(null)}
        >
          <CancelVisitForm
            booking={modal.booking}
            onCancel={() => setModal(null)}
            onSaved={(feeApplied) => changed(
              feeApplied
                ? "Visit cancelled and cancellation fee added."
                : "Visit cancelled. The recurring service remains active."
            )}
          />
        </Modal>
      )}
      {modal?.type === "edit-booking" && (
        <Modal
          title={`Edit service - ${modal.booking.customerName}`}
          description={modal.booking.recurringServiceId
            ? "Choose whether to update one visit or the recurring service."
            : "Changes apply to this scheduled visit only."}
          onClose={() => setModal(null)}
        >
          <EditBookingForm
            booking={modal.booking}
            serviceTypes={referenceData.data?.serviceTypes || []}
            teams={teams}
            onCancel={() => setModal(null)}
            onSaved={(scope) => changed(scope === "future"
              ? "Recurring service and future visits updated."
              : "Scheduled service updated.")}
          />
        </Modal>
      )}
      {modal?.type === "restore-booking" && (
        <Modal
          title={`Restore visit - ${modal.booking.customerName}`}
          description="Choose a new date, time, and crew for this cancelled visit."
          onClose={() => setModal(null)}
        >
          <RestoreVisitForm
            booking={modal.booking}
            teams={referenceData.data?.teams || []}
            onCancel={() => setModal(null)}
            onSaved={(feePreserved) => changed(
              feePreserved
                ? "Visit restored. The previously paid cancellation fee was preserved."
                : "Visit restored to the schedule."
            )}
          />
        </Modal>
      )}
      {modal?.type === "resume-plan" && (
        <Modal
          title={`Resume plan - ${modal.plan.customerName}`}
          description="Choose the first date the customer wants service again."
          onClose={() => setModal(null)}
        >
          <ResumePlanForm
            plan={modal.plan}
            onCancel={() => setModal(null)}
            onSaved={() => changed("Service plan resumed from the selected date.")}
          />
        </Modal>
      )}
      {modal?.type === "place" && (
        <Modal title={`Place ${modal.service.customerName}`} description={`${shortDate(modal.service.nextServiceDate)} in Schedule ${modal.service.week}.`} onClose={() => setModal(null)}>
          <PlaceOtherForm
            reference={reference}
            service={modal.service}
            onCancel={() => setModal(null)}
            onSaved={() => changed("Recurring visit placed on the crew schedule.")}
          />
        </Modal>
      )}
      {modal?.type === "next-service-date" && (
        <Modal title={`Set next service - ${modal.service.customerName}`} onClose={() => setModal(null)}>
          <NextServiceDateForm
            reference={reference}
            service={modal.service}
            onCancel={() => setModal(null)}
            onSaved={() => changed("Next service date updated.")}
          />
        </Modal>
      )}
      {modal?.type === "resolve-issue" && (
        <Modal title={`Resolve issue - ${modal.issue.customerName}`} onClose={() => setModal(null)}>
          <ResolveIssueForm
            issue={modal.issue}
            onCancel={() => setModal(null)}
            onSaved={() => changed("Job issue resolved.")}
          />
        </Modal>
      )}
    </>
  );
}

function WeeklySchedule({
  dayIndex,
  hasUnassigned,
  plan,
  selectedDay,
  teamId,
  onCancelBooking,
  onDayChange,
  onDuplicate,
  onEdit,
  onFinalizeRoute,
  onPlaceFlexible,
  onTeamChange,
  onUnassign
}) {
  if (!plan?.days?.length) {
    return <StatePanel title="No schedule dates" message="This schedule week has no available days." />;
  }
  const crewTabs = [
    ...plan.teams,
    ...(hasUnassigned ? [{ id: "unassigned", name: "Unassigned" }] : [])
  ];
  const selectedCrew = teamId || crewTabs[0]?.id || "unassigned";
  const crewBookings = (selectedDay?.bookings || []).filter((booking) =>
    selectedCrew === "unassigned" ? !booking.teamId : booking.teamId === selectedCrew
  );
  const route = crewBookings.find((booking) => booking.routeId);

  return (
    <div className="weekly-schedule-layout">
      <div className="schedule-day-tabs" role="tablist" aria-label="Days of the week" aria-orientation="vertical">
        {plan.days.map((day, index) => (
          <button
            aria-selected={dayIndex === index}
            className={dayIndex === index ? "active" : ""}
            key={day.date}
            role="tab"
            type="button"
            onClick={() => onDayChange(index)}
          >
            <span>{day.dayName}</span>
            <small>{shortDate(day.date)}</small>
          </button>
        ))}
      </div>

      <div className="crew-schedule">
        {(selectedDay?.flexibleServices || []).length > 0 && (
          <div className="flexible-due-list">
            <strong>Unplaced flexible visits</strong>
            {selectedDay.flexibleServices.map((service) => (
              <article key={service.id}>
                <div>
                  <span>{service.customerName}</span>
                  <small>{service.addressLine1} · {recurrenceLabel(service.recurrenceRule)}</small>
                </div>
                <div>
                  <small>Last crew</small>
                  <span>{service.lastTeamName || "No prior crew"}</span>
                </div>
                <button className="text-button" type="button" onClick={() => onPlaceFlexible(service)}>
                  Place visit
                </button>
              </article>
            ))}
          </div>
        )}
        <div className="crew-tabs" role="tablist" aria-label="Cleaning crews">
          {crewTabs.map((team) => (
            <button
              aria-selected={selectedCrew === team.id}
              className={selectedCrew === team.id ? "active" : ""}
              key={team.id}
              role="tab"
              type="button"
              onClick={() => onTeamChange(team.id)}
            >
              {team.name}
            </button>
          ))}
        </div>
        {route && (
          <div className="route-publish-bar">
            <div>
              <span>Captain route</span>
              <StatusBadge status={route.routeStatus || "draft"} />
            </div>
            {route.routeStatus === "draft" && (
              <button
                className="primary-button inline-button"
                type="button"
                onClick={() => onFinalizeRoute(route.routeId)}
              >
                Finalize crew route
              </button>
            )}
          </div>
        )}
        {crewTabs.length === 0 ? (
          <StatePanel title="No cleaning crews" message="Add an active team before assigning work." />
        ) : (
          <TimeBlockSchedule
            bookings={crewBookings}
            onCancelBooking={onCancelBooking}
            onDuplicate={onDuplicate}
            onEdit={onEdit}
            onUnassign={onUnassign}
          />
        )}
      </div>
    </div>
  );
}

function TimeBlockSchedule({ bookings, onCancelBooking, onDuplicate, onEdit, onUnassign }) {
  return (
    <div className="time-block-table">
      <div className="time-block-row time-block-head">
        <span>Time</span><span>Client</span><span>Address</span><span>Billing</span><span>Rate</span><span>Special instructions</span><span>Actions</span>
      </div>
      {[
        ["08:00", "8:00 AM"],
        ["10:30", "10:30 AM"],
        ["13:00", "1:00 PM"],
        ["15:00", "3:00 PM"]
      ].map(([value, label]) => {
        const matches = bookings.filter((booking) => booking.startTime === value);
        if (!matches.length) {
          return (
            <div className="time-block-row empty" key={value}>
              <strong data-label="Time">{label}</strong>
              <span className="open-block">Open</span>
            </div>
          );
        }
        return matches.map((booking, index) => (
          <article className="time-block-row" key={booking.id}>
            <strong data-label="Time">{index === 0 ? label : ""}</strong>
            <div data-label="Client"><strong>{booking.customerName}</strong><small>{booking.serviceName}</small></div>
            <div data-label="Address"><span>{booking.addressLine1}</span><small>{booking.city}, {booking.state} {booking.postalCode}</small></div>
            <span data-label="Billing">{booking.billingType === "hourly" ? "Hourly" : "Flat fee"}</span>
            <strong data-label="Rate">
              {money(booking.billingType === "hourly" ? booking.billingRateCents : booking.priceCents)}
              {booking.billingType === "hourly" ? "/hr" : ""}
            </strong>
            <span data-label="Special instructions">{booking.specialInstructions || "None"}</span>
            <div className="row-actions" data-label="Actions">
              {booking.canMove ? (
                <>
                  <button className="text-button" type="button" onClick={() => onEdit(booking)}>Edit service</button>
                  {!booking.recurringServiceId && (
                    <button className="text-button" type="button" onClick={() => onDuplicate(booking)}>Duplicate</button>
                  )}
                  {booking.teamId && <button className="text-button" type="button" onClick={() => onUnassign(booking)}>Unassign</button>}
                  <button className="text-button danger-text" type="button" onClick={() => onCancelBooking(booking)}>Cancel visit</button>
                </>
              ) : <span className="muted">History</span>}
            </div>
          </article>
        ));
      })}
    </div>
  );
}

function OtherServices({
  reference,
  services,
  onPlace,
  onSetNextDate,
  onReferenceChange
}) {
  return (
    <>
      <div className="toolbar">
        <Field label="Show next service on or after">
          <input type="date" value={reference} onChange={(event) => onReferenceChange(event.target.value)} />
        </Field>
      </div>
      {services.length === 0 ? (
        <StatePanel title="No flexible recurring clients" message="Three-week, monthly, and individual-date services will appear here." />
      ) : (
        <div className="data-table other-services-table">
          <div className="data-row data-head"><span>Client</span><span>Address</span><span>Frequency</span><span>Next service</span><span>Schedule</span><span>Last crew</span><span>Actions</span></div>
          {services.map((service) => (
            <article className="data-row" key={service.id}>
              <div data-label="Client"><strong>{service.customerName}</strong><small>{service.serviceName}</small></div>
              <div data-label="Address"><span>{service.addressLine1}</span><small>{service.city}, {service.postalCode}</small></div>
              <span data-label="Frequency">{recurrenceLabel(service.recurrenceRule)}</span>
              <strong data-label="Next service">{shortDate(service.nextServiceDate)}</strong>
              <span data-label="Schedule">Schedule {service.week}</span>
              <span data-label="Last crew">{service.lastTeamName || "No prior crew"}</span>
              <div className="row-actions" data-label="Actions">
                <button className="text-button" disabled={!service.nextServiceDate} type="button" onClick={() => onPlace(service)}>Place</button>
                <button className="text-button" type="button" onClick={() => onSetNextDate(service)}>Set next date</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function RecurringPlans({
  plans,
  status,
  onEnd,
  onPause,
  onResume,
  onStatusChange
}) {
  return (
    <>
      <div className="toolbar">
        <Field label="Plan status">
          <select value={status} onChange={(event) => onStatusChange(event.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="ended">Ended</option>
          </select>
        </Field>
      </div>
      {!plans.length ? (
        <StatePanel title="No service plans" message="There are no recurring service plans matching this status." />
      ) : (
        <div className="data-table recurring-plan-table">
          <div className="data-row data-head">
            <span>Client</span><span>Property</span><span>Frequency</span><span>Preferred crew</span><span>Status</span><span>Actions</span>
          </div>
          {plans.map((planItem) => (
            <article className="data-row" key={planItem.id}>
              <div data-label="Client"><strong>{planItem.customerName}</strong><small>{planItem.serviceName}</small></div>
              <div data-label="Property"><span>{planItem.addressLine1}</span><small>{planItem.city}, {planItem.postalCode}</small></div>
              <span data-label="Frequency">{recurrenceLabel(planItem.recurrenceRule)}</span>
              <span data-label="Preferred crew">{planItem.preferredTeamName || "Any available crew"}</span>
              <div data-label="Status"><StatusBadge status={planItem.status} /></div>
              <div className="row-actions" data-label="Actions">
                {planItem.status === "active" && (
                  <button className="text-button" type="button" onClick={() => onPause(planItem)}>Pause</button>
                )}
                {planItem.status === "paused" && (
                  <button className="text-button" type="button" onClick={() => onResume(planItem)}>Resume</button>
                )}
                {planItem.status !== "ended" && (
                  <button className="text-button danger-text" type="button" onClick={() => onEnd(planItem)}>End plan</button>
                )}
                {planItem.status === "ended" && <span className="muted">Closed</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function ResumePlanForm({ plan, onCancel, onSaved }) {
  const [restartOn, setRestartOn] = useState(nextScheduleDate(localDate()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    const selected = new Date(`${restartOn}T12:00:00`);
    let recurrenceRule = plan.recurrenceRule;
    if (recurrenceRule.type === "dates") {
      const dates = recurrenceRule.dates.filter((value) => value >= restartOn);
      dates.push(restartOn);
      recurrenceRule = { type: "dates", dates: [...new Set(dates)].sort() };
    }
    if (recurrenceRule.type === "monthly") {
      recurrenceRule = { type: "monthly", dayOfMonth: selected.getDate() };
    }
    if (recurrenceRule.type === "nth_weekday") {
      const weekday = selected.getDay();
      const occurrence = Math.ceil(selected.getDate() / 7);
      if (weekday === 0 || weekday === 6 || occurrence > 4) {
        setError("Monthly weekday services must use the first through fourth Monday-Friday.");
        return;
      }
      recurrenceRule = { type: "nth_weekday", weekday, occurrence };
    }
    setSaving(true);
    setError("");
    try {
      await api.patch(`/recurring-services/${plan.id}`, {
        status: "active",
        startsOn: recurrenceRule.type === "dates" ? recurrenceRule.dates[0] : restartOn,
        restartOn,
        recurrenceRule
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="First service date">
        <input required min={localDate()} type="date" value={restartOn} onChange={(event) => setRestartOn(event.target.value)} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="Resume plan" />
    </form>
  );
}

function ServiceHistory({ data, from, to, onFromChange, onRestore, onToChange }) {
  const services = data?.services || [];
  return (
    <>
      <div className="toolbar history-toolbar">
        <Field label="From"><input type="date" value={from} onChange={(event) => onFromChange(event.target.value)} /></Field>
        <Field label="Through"><input type="date" value={to} onChange={(event) => onToChange(event.target.value)} /></Field>
      </div>
      {services.length === 0 ? (
        <StatePanel title="No past services" message="Completed and past bookings in this date range will appear here." />
      ) : (
        <div className="data-table service-history-table">
          <div className="data-row data-head"><span>Date</span><span>Client</span><span>Service</span><span>Crew</span><span>Cleaners</span><span>Status</span><span>Actions</span></div>
          {services.map((service) => (
            <article className="data-row" key={service.id}>
              <div data-label="Date"><strong>{shortDate(service.serviceDate)}</strong><small>{clock(service.scheduledStart)}</small></div>
              <div data-label="Client"><strong>{service.customerName}</strong><small>{service.addressLine1}, {service.city}</small></div>
              <div data-label="Service"><span>{service.serviceName}</span><small>{service.billingType === "hourly" ? `${money(service.billingRateCents)}/hr` : money(service.priceCents)}</small></div>
              <span data-label="Crew">{service.teamName || "Unassigned"}</span>
              <span data-label="Cleaners">{service.employeeNames?.join(", ") || "Not recorded"}</span>
              <div data-label="Status"><StatusBadge status={service.status} /></div>
              <div data-label="Actions">
                {service.status === "cancelled"
                  ? <button className="text-button" type="button" onClick={() => onRestore(service)}>Restore visit</button>
                  : <span className="muted">-</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function RestoreVisitForm({ booking, teams, onCancel, onSaved }) {
  const [form, setForm] = useState({
    date: nextScheduleDate(localDate()),
    startTime: "08:00",
    teamId: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await api.post(`/schedule-planner/bookings/${booking.id}/restore`, {
        ...form,
        teamId: form.teamId || null
      });
      onSaved(result.booking.preservedPaidFee);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Service date">
          <input required min={localDate()} type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </Field>
        <Field label="Time block">
          <select value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })}>
            <option value="08:00">8:00 AM</option><option value="10:30">10:30 AM</option>
            <option value="13:00">1:00 PM</option><option value="15:00">3:00 PM</option>
          </select>
        </Field>
        <Field label="Cleaning crew">
          <select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}>
            <option value="">Unassigned</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </Field>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="Restore visit" />
    </form>
  );
}

function JobIssues({ issues, status, onResolve, onStatusChange }) {
  return (
    <>
      <div className="toolbar">
        <Field label="Issue status">
          <select value={status} onChange={(event) => onStatusChange(event.target.value)}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </Field>
      </div>
      {!issues.length ? (
        <StatePanel title="No job issues" message="There are no job issues matching this status." />
      ) : (
        <div className="data-table job-issue-table">
          <div className="data-row data-head">
            <span>Client</span><span>Date</span><span>Issue</span><span>Reported by</span><span>Status</span><span>Actions</span>
          </div>
          {issues.map((issue) => (
            <article className="data-row" key={issue.id}>
              <div data-label="Client"><strong>{issue.customerName}</strong><small>{issue.addressLine1}</small></div>
              <span data-label="Date">{shortDate(issue.serviceDate)}</span>
              <div data-label="Issue"><strong>{capitalize(issue.type.replaceAll("_", " "))}</strong><small>{issue.description}</small></div>
              <span data-label="Reported by">
                {[issue.reportedByFirstName, issue.reportedByLastName].filter(Boolean).join(" ") || "Manager"}
              </span>
              <div data-label="Status"><StatusBadge status={issue.resolvedAt ? "resolved" : "open"} /></div>
              <div className="row-actions" data-label="Actions">
                {!issue.resolvedAt
                  ? <button className="text-button" type="button" onClick={() => onResolve(issue)}>Resolve</button>
                  : <span className="muted">Resolved</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function ResolveIssueForm({ issue, onCancel, onSaved }) {
  const [form, setForm] = useState({
    customerApproved: false,
    additionalCharge: "",
    resolutionNotes: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.patch(`/job-issues/${issue.id}`, {
        customerApproved: form.customerApproved,
        additionalChargeCents: form.customerApproved
          ? cents(form.additionalCharge)
          : null,
        resolutionNotes: form.resolutionNotes
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <label className="checkbox-field">
        <input
          checked={form.customerApproved}
          type="checkbox"
          onChange={(event) => setForm({ ...form, customerApproved: event.target.checked })}
        />
        Customer approved additional work
      </label>
      {form.customerApproved && (
        <Field label="Additional charge">
          <input required min="0.01" step="0.01" type="number" value={form.additionalCharge} onChange={(event) => setForm({ ...form, additionalCharge: event.target.value })} />
        </Field>
      )}
      <Field label="Resolution notes">
        <textarea required maxLength="2000" rows="4" value={form.resolutionNotes} onChange={(event) => setForm({ ...form, resolutionNotes: event.target.value })} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="Resolve issue" />
    </form>
  );
}

function CustomerPropertyPicker({
  customerId,
  propertyId,
  initialCustomerSearch = "",
  initialPropertySearch = "",
  onChange
}) {
  const [customerSearch, setCustomerSearch] = useState(initialCustomerSearch);
  const [propertySearch, setPropertySearch] = useState(initialPropertySearch);
  const debouncedCustomerSearch = useDebouncedValue(customerSearch);
  const debouncedPropertySearch = useDebouncedValue(propertySearch);
  const customers = useLoad(() => api.list("customers", {
    status: "active",
    q: debouncedCustomerSearch,
    limit: 20
  }), [debouncedCustomerSearch]);
  const properties = useLoad(() => customerId
    ? api.list("properties", {
        customerId,
        active: true,
        q: debouncedPropertySearch,
        limit: 20
      })
    : Promise.resolve({ properties: [], pagination: { total: 0, limit: 20, offset: 0 } }),
  [customerId, debouncedPropertySearch]);

  useEffect(() => {
    const options = properties.data?.properties || [];
    if (propertyId && !options.some((property) => property.id === propertyId)) return;
    if (!propertyId && options.length === 1) {
      onChange({ customerId, propertyId: options[0].id });
    }
  }, [customerId, propertyId, properties.data]);

  return (
    <>
      <Field label="Find client">
        <input
          placeholder="Start typing a name, phone, or email"
          type="search"
          value={customerSearch}
          onChange={(event) => setCustomerSearch(event.target.value)}
        />
      </Field>
      <Field label="Client">
        <select
          required
          value={customerId}
          onChange={(event) => {
            onChange({ customerId: event.target.value, propertyId: "" });
            setPropertySearch("");
          }}
        >
          <option value="">Select client</option>
          {(customers.data?.customers || []).map((customer) => (
            <option key={customer.id} value={customer.id}>{customer.name} - {customer.phone}</option>
          ))}
        </select>
      </Field>
      {customerId && (
        <>
          <Field label="Find property">
            <input
              placeholder="Start typing an address"
              type="search"
              value={propertySearch}
              onChange={(event) => setPropertySearch(event.target.value)}
            />
          </Field>
          <Field label="Property">
            <select
              required
              value={propertyId}
              onChange={(event) => onChange({ customerId, propertyId: event.target.value })}
            >
              <option value="">Select property</option>
              {(properties.data?.properties || []).map((property) => (
                <option key={property.id} value={property.id}>
                  {property.addressLine1}, {property.city}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </>
  );
}

function PlannerBookingForm({
  data,
  initialBooking,
  initialDate,
  initialTeamId,
  onCancel,
  onSaved
}) {
  const serviceTypes = data?.serviceTypes || [];
  const teams = data?.teams || [];
  const [form, setForm] = useState({
    customerId: initialBooking?.customerId || "",
    propertyId: initialBooking?.propertyId || "",
    serviceTypeId: initialBooking?.serviceTypeId || serviceTypes[0]?.id || "",
    date: initialDate || localDate(),
    startTime: initialBooking?.startTime || "08:00",
    teamId: initialTeamId || "",
    expectedDurationMinutes: initialBooking?.expectedDurationMinutes
      || serviceTypes[0]?.defaultDurationMinutes
      || 150,
    billingType: initialBooking?.billingType || "flat",
    amount: initialBooking
      ? (Number(initialBooking.billingType === "hourly"
        ? initialBooking.billingRateCents
        : initialBooking.priceCents) / 100).toFixed(2)
      : "",
    specialRequests: initialBooking?.specialInstructions || ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const rate = cents(form.amount);
    try {
      const result = await api.post("/bookings", {
        customerId: form.customerId,
        propertyId: form.propertyId,
        serviceTypeId: form.serviceTypeId,
        status: "confirmed",
        scheduledStart: new Date(`${form.date}T${form.startTime}:00`).toISOString(),
        expectedDurationMinutes: Number(form.expectedDurationMinutes),
        priceCents: form.billingType === "hourly"
          ? Math.round(rate * Number(form.expectedDurationMinutes) / 60)
          : rate,
        billingType: form.billingType,
        billingRateCents: form.billingType === "hourly" ? rate : null,
        specialRequests: form.specialRequests,
        previousBookingId: initialBooking?.id || null,
        serviceDate: form.date,
        startTime: form.startTime,
        teamId: form.teamId || null
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <CustomerPropertyPicker
          customerId={form.customerId}
          initialCustomerSearch={initialBooking?.customerName || ""}
          initialPropertySearch={initialBooking?.addressLine1 || ""}
          propertyId={form.propertyId}
          onChange={(selection) => setForm((current) => ({ ...current, ...selection }))}
        />
        <Field label="Service">
          <select
            required
            value={form.serviceTypeId}
            onChange={(event) => {
              const service = serviceTypes.find((item) => item.id === event.target.value);
              setForm({ ...form, serviceTypeId: event.target.value, expectedDurationMinutes: service?.defaultDurationMinutes || form.expectedDurationMinutes });
            }}
          >
            <option value="">Select service</option>
            {serviceTypes.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </select>
        </Field>
        <Field label="Cleaning crew">
          <select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}>
            <option value="">Unassigned</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </Field>
        <Field label="Service date"><input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
        <Field label="Time block">
          <select value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })}>
            <option value="08:00">8:00 AM</option><option value="10:30">10:30 AM</option>
            <option value="13:00">1:00 PM</option><option value="15:00">3:00 PM</option>
          </select>
        </Field>
        <Field label="Estimated duration">
          <input required min="30" max="1440" step="15" type="number" value={form.expectedDurationMinutes} onChange={(event) => setForm({ ...form, expectedDurationMinutes: event.target.value })} />
        </Field>
        <Field label="Billing">
          <select value={form.billingType} onChange={(event) => setForm({ ...form, billingType: event.target.value })}>
            <option value="flat">Flat fee</option><option value="hourly">Hourly</option>
          </select>
        </Field>
        <Field label={form.billingType === "hourly" ? "Hourly rate" : "Flat fee"}>
          <input required min="0" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
        </Field>
      </div>
      <Field label="Special instructions"><textarea rows="3" maxLength="5000" value={form.specialRequests} onChange={(event) => setForm({ ...form, specialRequests: event.target.value })} /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions
        saving={saving}
        disabled={!form.propertyId || !form.serviceTypeId}
        onCancel={onCancel}
        submitLabel={initialBooking ? "Duplicate booking" : "Add booking"}
      />
    </form>
  );
}

function RecurringServiceForm({ data, initialDate, onCancel, onSaved }) {
  const serviceTypes = data?.serviceTypes || [];
  const teams = data?.teams || [];
  const [form, setForm] = useState({
    customerId: "",
    propertyId: "",
    serviceTypeId: serviceTypes[0]?.id || "",
    preferredTeamId: teams[0]?.id || "",
    frequency: "biweekly",
    startsOn: initialDate || localDate(),
    preferredStartTime: "08:00",
    expectedDurationMinutes: serviceTypes[0]?.defaultDurationMinutes || 150,
    billingType: "flat",
    amount: "",
    dayOfMonth: "1",
    occurrence: "1",
    weekday: "1",
    individualDate: initialDate || localDate(),
    individualDates: initialDate ? [initialDate] : [],
    specialInstructions: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const rate = cents(form.amount);
    const recurrenceRule = form.frequency === "individual_dates"
      ? { type: "dates", dates: [...form.individualDates].sort() }
      : form.frequency === "weekly"
      ? { type: "weekly", intervalWeeks: 1 }
      : form.frequency === "biweekly"
        ? { type: "weekly", intervalWeeks: 2 }
        : form.frequency === "three_week"
          ? { type: "weekly", intervalWeeks: 3 }
          : form.frequency === "monthly_date"
            ? { type: "monthly", dayOfMonth: Number(form.dayOfMonth) }
            : {
                type: "nth_weekday",
                occurrence: Number(form.occurrence),
                weekday: Number(form.weekday)
              };
    try {
      await api.post("/recurring-services", {
        customerId: form.customerId,
        propertyId: form.propertyId,
        serviceTypeId: form.serviceTypeId,
        preferredTeamId: form.preferredTeamId || null,
        status: "active",
        recurrenceRule,
        preferredStartTime: form.preferredStartTime,
        expectedDurationMinutes: Number(form.expectedDurationMinutes),
        priceCents: form.billingType === "hourly"
          ? Math.round(rate * Number(form.expectedDurationMinutes) / 60)
          : rate,
        billingType: form.billingType,
        billingRateCents: form.billingType === "hourly" ? rate : null,
        specialInstructions: form.specialInstructions,
        startsOn: form.frequency === "individual_dates"
          ? [...form.individualDates].sort()[0]
          : form.startsOn
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <CustomerPropertyPicker
          customerId={form.customerId}
          propertyId={form.propertyId}
          onChange={(selection) => setForm((current) => ({ ...current, ...selection }))}
        />
        <Field label="Service">
          <select
            required
            value={form.serviceTypeId}
            onChange={(event) => {
              const service = serviceTypes.find((item) => item.id === event.target.value);
              setForm({ ...form, serviceTypeId: event.target.value, expectedDurationMinutes: service?.defaultDurationMinutes || form.expectedDurationMinutes });
            }}
          >
            <option value="">Select service</option>
            {serviceTypes.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </select>
        </Field>
        <Field label="Preferred crew">
          <select value={form.preferredTeamId} onChange={(event) => setForm({ ...form, preferredTeamId: event.target.value })}>
            <option value="">No preferred crew</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </Field>
        <Field label="Frequency">
          <select value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="three_week">Every 3 weeks</option>
            <option value="monthly_date">Monthly date</option>
            <option value="nth_weekday">Monthly weekday</option>
            <option value="individual_dates">Individual dates</option>
          </select>
        </Field>
        {form.frequency !== "individual_dates" && (
          <Field label="First service"><input required type="date" value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} /></Field>
        )}
        {form.frequency === "monthly_date" && (
          <Field label="Day of month"><input required min="1" max="31" type="number" value={form.dayOfMonth} onChange={(event) => setForm({ ...form, dayOfMonth: event.target.value })} /></Field>
        )}
        {form.frequency === "nth_weekday" && (
          <>
            <Field label="Week of month">
              <select value={form.occurrence} onChange={(event) => setForm({ ...form, occurrence: event.target.value })}>
                <option value="1">First</option><option value="2">Second</option><option value="3">Third</option>
                <option value="4">Fourth</option>
              </select>
            </Field>
            <Field label="Weekday">
              <select value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>
                <option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option>
                <option value="4">Thursday</option><option value="5">Friday</option>
              </select>
            </Field>
          </>
        )}
        {form.frequency === "individual_dates" && (
          <div className="individual-date-picker">
            <Field label="Service date">
              <input
                min={localDate()}
                type="date"
                value={form.individualDate}
                onChange={(event) => setForm({ ...form, individualDate: event.target.value })}
              />
            </Field>
            <button
              className="secondary-button compact-button"
              disabled={!form.individualDate || form.individualDates.includes(form.individualDate)}
              type="button"
              onClick={() => setForm({
                ...form,
                individualDates: [...form.individualDates, form.individualDate].sort()
              })}
            >
              Add date
            </button>
          </div>
        )}
        <Field label="Time block">
          <select value={form.preferredStartTime} onChange={(event) => setForm({ ...form, preferredStartTime: event.target.value })}>
            <option value="08:00">8:00 AM</option><option value="10:30">10:30 AM</option>
            <option value="13:00">1:00 PM</option><option value="15:00">3:00 PM</option>
          </select>
        </Field>
        <Field label="Estimated duration">
          <input required min="30" max="1440" step="15" type="number" value={form.expectedDurationMinutes} onChange={(event) => setForm({ ...form, expectedDurationMinutes: event.target.value })} />
        </Field>
        <Field label="Billing">
          <select value={form.billingType} onChange={(event) => setForm({ ...form, billingType: event.target.value })}>
            <option value="flat">Flat fee</option><option value="hourly">Hourly</option>
          </select>
        </Field>
        <Field label={form.billingType === "hourly" ? "Hourly rate" : "Flat fee"}>
          <input required min="0" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
        </Field>
      </div>
      {form.frequency === "individual_dates" && (
        <div className="selected-date-list" aria-label="Selected service dates">
          {form.individualDates.length ? form.individualDates.map((date) => (
            <div key={date}>
              <span>{shortDate(date)}</span>
              <button
                aria-label={`Remove ${shortDate(date)}`}
                className="text-button danger-text"
                type="button"
                onClick={() => setForm({
                  ...form,
                  individualDates: form.individualDates.filter((value) => value !== date)
                })}
              >
                Remove
              </button>
            </div>
          )) : <p className="form-error">Add at least one service date.</p>}
        </div>
      )}
      <Field label="Special instructions"><textarea rows="3" maxLength="5000" value={form.specialInstructions} onChange={(event) => setForm({ ...form, specialInstructions: event.target.value })} /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions
        saving={saving}
        disabled={!form.propertyId || !form.serviceTypeId
          || (form.frequency === "individual_dates" && !form.individualDates.length)}
        onCancel={onCancel}
        submitLabel="Add recurring service"
      />
    </form>
  );
}

function EditBookingForm({ booking, serviceTypes, teams, onCancel, onSaved }) {
  const [form, setForm] = useState({
    updateScope: "single",
    serviceDate: booking.serviceDate,
    startTime: booking.startTime,
    teamId: booking.teamId || "",
    serviceTypeId: booking.serviceTypeId || "",
    expectedDurationMinutes: booking.expectedDurationMinutes || 150,
    billingType: booking.billingType || "flat",
    amount: ((booking.billingType === "hourly"
      ? booking.billingRateCents
      : booking.priceCents) / 100).toFixed(2),
    specialRequests: booking.specialInstructions || ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const rate = cents(form.amount);
    try {
      await api.patch(`/bookings/${booking.id}`, {
        updateScope: form.updateScope,
        serviceDate: form.serviceDate,
        startTime: form.startTime,
        teamId: form.teamId || null,
        serviceTypeId: form.serviceTypeId,
        expectedDurationMinutes: Number(form.expectedDurationMinutes),
        priceCents: form.billingType === "hourly"
          ? Math.round(rate * Number(form.expectedDurationMinutes) / 60)
          : rate,
        billingType: form.billingType,
        billingRateCents: form.billingType === "hourly" ? rate : null,
        specialRequests: form.specialRequests
      });
      onSaved(form.updateScope);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      {booking.recurringServiceId && (
        <Field label="Apply changes to">
          <select
            value={form.updateScope}
            onChange={(event) => setForm({ ...form, updateScope: event.target.value })}
          >
            <option value="single">This visit only</option>
            <option value="future">This and future visits</option>
          </select>
        </Field>
      )}
      <div className="form-grid">
        <Field label="Service date">
          <input
            required
            min={localDate()}
            type="date"
            value={form.serviceDate}
            onChange={(event) => setForm({ ...form, serviceDate: event.target.value })}
          />
        </Field>
        <Field label="Time block">
          <select value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })}>
            <option value="08:00">8:00 AM</option><option value="10:30">10:30 AM</option>
            <option value="13:00">1:00 PM</option><option value="15:00">3:00 PM</option>
          </select>
        </Field>
        <Field label="Cleaning crew">
          <select value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}>
            <option value="">Unassigned</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </Field>
        <Field label="Service">
          <select required value={form.serviceTypeId} onChange={(event) => setForm({ ...form, serviceTypeId: event.target.value })}>
            <option value="">Select service</option>
            {serviceTypes.map((service) => (
              <option key={service.id} value={service.id}>{service.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Estimated duration">
          <input
            required
            min="30"
            max="1440"
            step="15"
            type="number"
            value={form.expectedDurationMinutes}
            onChange={(event) => setForm({ ...form, expectedDurationMinutes: event.target.value })}
          />
        </Field>
        <Field label="Billing">
          <select value={form.billingType} onChange={(event) => setForm({ ...form, billingType: event.target.value })}>
            <option value="flat">Flat fee</option>
            <option value="hourly">Hourly</option>
          </select>
        </Field>
        <Field label={form.billingType === "hourly" ? "Hourly rate" : "Flat fee"}>
          <input required min="0" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
        </Field>
      </div>
      <Field label="Special instructions">
        <textarea rows="4" maxLength="5000" value={form.specialRequests} onChange={(event) => setForm({ ...form, specialRequests: event.target.value })} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="Save service" />
    </form>
  );
}

function CancelVisitForm({ booking, onCancel, onSaved }) {
  const settings = useLoad(() => api.settings(), []);
  const [reason, setReason] = useState("");
  const [applyFee, setApplyFee] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const feeCents = settings.data?.settings?.lateCancellationFeeCents || 0;
  const [within48Hours] = useState(() => {
    const hours = (
      new Date(booking.scheduledStart).getTime() - Date.now()
    ) / 3_600_000;
    return hours > 0 && hours <= 48;
  });

  useEffect(() => {
    if (settings.status === "ready" && within48Hours) {
      setApplyFee(feeCents > 0);
    }
  }, [settings.status, feeCents, within48Hours]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await api.post(`/schedule-planner/bookings/${booking.id}/cancel`, {
        reason,
        applyFee
      });
      onSaved(result.cancellationFeeCents > 0);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Cancellation reason">
        <textarea
          autoFocus
          maxLength="1000"
          placeholder="Optional"
          rows="3"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {settings.status === "ready" && feeCents > 0 && (
        <label className="checkbox-field">
          <input
            checked={applyFee}
            type="checkbox"
            onChange={(event) => setApplyFee(event.target.checked)}
          />
          <span>
            Apply {money(feeCents)} cancellation fee
            {within48Hours && <small>Inside the 48-hour cancellation window</small>}
          </span>
        </label>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions
        danger
        saving={saving}
        onCancel={onCancel}
        submitLabel="Cancel visit"
      />
    </form>
  );
}

function PlaceOtherForm({ service, onCancel, onSaved }) {
  const blocks = [
    ["08:00", "8:00 AM"],
    ["10:30", "10:30 AM"],
    ["13:00", "1:00 PM"],
    ["15:00", "3:00 PM"]
  ];
  const availability = useLoad(async () => {
    await api.post("/schedule-planner/sync", { reference: service.nextServiceDate });
    return api.get("/schedule-planner", {
      week: service.week,
      reference: service.nextServiceDate
    });
  }, [service.id, service.nextServiceDate, service.week]);
  const teams = availability.data?.teams || [];
  const serviceDay = availability.data?.days?.find((day) =>
    day.date === service.nextServiceDate
  );
  const [teamId, setTeamId] = useState(service.preferredTeamId || "");
  const [startTime, setStartTime] = useState(
    String(service.preferredStartTime || "08:00").slice(0, 5)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const freeBlocks = (selectedTeamId) => blocks.filter(([value]) =>
    !(serviceDay?.bookings || []).some((booking) =>
      booking.teamId === selectedTeamId && booking.startTime === value
    )
  );

  useEffect(() => {
    if (!teams.length) return;
    const selectedTeam = teams.find((team) => team.id === teamId);
    const teamWithSpace = selectedTeam && freeBlocks(selectedTeam.id).length
      ? selectedTeam
      : teams.find((team) => freeBlocks(team.id).length);
    if (!teamWithSpace) return;
    const available = freeBlocks(teamWithSpace.id);
    if (teamId !== teamWithSpace.id) setTeamId(teamWithSpace.id);
    if (!available.some(([value]) => value === startTime)) {
      setStartTime(available[0][0]);
    }
  }, [availability.data, teamId]);

  const availableBlocks = freeBlocks(teamId);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/schedule-planner/others/${service.id}/place`, {
        reference: service.nextServiceDate,
        week: service.week,
        teamId,
        startTime
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="placement-summary">
        <span>Due occurrence</span>
        <strong>{shortDate(service.nextServiceDate)}</strong>
        <small>{recurrenceLabel(service.recurrenceRule)}</small>
      </div>
      {availability.status === "loading" && <LoadingRows />}
      {availability.status === "error" && (
        <StatePanel
          title="Schedule unavailable"
          message={availability.error}
          action={<button className="text-button" type="button" onClick={availability.reload}>Try again</button>}
        />
      )}
      {availability.status === "ready" && !teams.some((team) => freeBlocks(team.id).length) && (
        <StatePanel title="No open time blocks" message="Every crew is already booked for this service date." />
      )}
      <div className="form-grid">
        <Field label="Cleaning crew">
          <select required value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            <option value="">Select crew</option>
            {teams.filter((team) => freeBlocks(team.id).length).map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Time block">
          <select value={startTime} onChange={(event) => setStartTime(event.target.value)}>
            {availableBlocks.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions
        saving={saving}
        disabled={!teamId || !availableBlocks.length || availability.status !== "ready"}
        onCancel={onCancel}
        submitLabel="Place visit"
      />
    </form>
  );
}

function NextServiceDateForm({ reference, service, onCancel, onSaved }) {
  const [nextDate, setNextDate] = useState(service.nextServiceDate || reference);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const selected = new Date(`${nextDate}T12:00:00`);
    let recurrenceRule = service.recurrenceRule;
    let startsOn = nextDate;
    if (recurrenceRule.type === "dates") {
      const dates = recurrenceRule.dates
        .filter((value) => value !== service.nextDueDate);
      dates.push(nextDate);
      dates.sort();
      recurrenceRule = { type: "dates", dates: [...new Set(dates)] };
      startsOn = recurrenceRule.dates[0];
    }
    if (recurrenceRule.type === "monthly") {
      recurrenceRule = { type: "monthly", dayOfMonth: selected.getDate() };
    }
    if (recurrenceRule.type === "nth_weekday") {
      const weekday = selected.getDay();
      const occurrence = Math.ceil(selected.getDate() / 7);
      if (weekday === 0 || weekday === 6 || occurrence > 4) {
        setSaving(false);
        setError("Monthly weekday services must use the first through fourth Monday-Friday.");
        return;
      }
      recurrenceRule = { type: "nth_weekday", weekday, occurrence };
    }
    try {
      await api.patch(`/recurring-services/${service.id}`, {
        startsOn,
        recurrenceRule
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Next service date">
        <input
          required
          min={reference}
          type="date"
          value={nextDate}
          onChange={(event) => setNextDate(event.target.value)}
        />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="Set next date" />
    </form>
  );
}

function CleanerPage({ path }) {
  if (path !== "/" && path !== "/schedule") return <NotFoundPage />;
  return <CleanerRoutePage />;
}

function CleanerRoutePage() {
  const [date, setDate] = useState(localDate());
  const [issueStop, setIssueStop] = useState(null);
  const [notice, setNotice] = useState(null);
  const resource = useLoad(() => api.myRoute(date), [date]);
  const route = resource.data?.route;
  const stops = resource.data?.stops || [];

  async function routeAction(action) {
    try {
      await api.post(`/routes/${route.id}/${action}`);
      setNotice({ message: action === "check-in" ? "Team checked in." : "Team checked out." });
      resource.reload();
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Assigned work"
        title="My route"
        description="Service order, property instructions, and job reporting."
      >
        <input aria-label="Route date" className="date-control" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        {route?.isCaptain && ["finalized", "in_progress"].includes(route.status) && (
          <button
            className="primary-button inline-button"
            type="button"
            onClick={() => routeAction(route.status === "in_progress" ? "check-out" : "check-in")}
          >
            {route.status === "in_progress" ? "Check out team" : "Check in team"}
          </button>
        )}
      </PageHeader>
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <section className="section-block">
        {resource.status === "loading" && <LoadingRows />}
        {resource.status === "error" && <StatePanel title="Route unavailable" message={resource.error} action={<button className="text-button" onClick={resource.reload}>Try again</button>} />}
        {resource.status === "ready" && !route && <StatePanel title="No assigned route" message="There is no route assigned to you for this date." />}
        {resource.status === "ready" && route && (
          <>
            <div className="route-summary">
              <div><span>Team</span><strong>{route.teamName}</strong></div>
              <div><span>Role</span><strong>{route.isCaptain ? "Captain" : "Cleaner"}</strong></div>
              <div><span>Status</span><StatusBadge status={route.status} /></div>
              <div><span>Stops</span><strong>{stops.length}</strong></div>
            </div>
            <div className="cleaner-route">
              {stops.map((stop, index) => (
                <article className="cleaner-stop" key={stop.id}>
                  <div className="route-order">{stop.stopOrder || index + 1}</div>
                  <div className="stop-body">
                    <div className="stop-heading">
                      <div>
                        <span className="route-time">{clock(stop.estimatedArrival)}</span>
                        <h2>{stop.customerName}</h2>
                        <p>{[stop.addressLine1, stop.addressLine2, stop.city, stop.state, stop.postalCode].filter(Boolean).join(", ")}</p>
                      </div>
                      <StatusBadge status={stop.status} />
                    </div>
                    <div className="stop-details">
                      <Detail label="Service" value={stop.serviceName} />
                      <Detail label="Travel" value={stop.travelMinutesFromPrevious ? `${stop.travelMinutesFromPrevious} min` : "First stop"} />
                      <Detail label="Access" value={stop.accessInstructions || "No special access instructions"} />
                      <Detail label="Service notes" value={stop.serviceNotes || stop.specialRequests || "No special requests"} />
                    </div>
                    {Array.isArray(stop.checklist) && stop.checklist.length > 0 && (
                      <div className="checklist-reference">
                        <strong>Service reference</strong>
                        <ul>{stop.checklist.map((item) => <li key={item}>{item}</li>)}</ul>
                      </div>
                    )}
                    <button className="secondary-button" type="button" onClick={() => setIssueStop(stop)}>Report job issue</button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {issueStop && (
        <Modal title={`Report issue - ${issueStop.customerName}`} onClose={() => setIssueStop(null)}>
          <IssueForm
            stop={issueStop}
            onCancel={() => setIssueStop(null)}
            onSaved={() => {
              setIssueStop(null);
              setNotice({ message: "Job issue reported to management." });
            }}
          />
        </Modal>
      )}
    </>
  );
}

function Detail({ label, value }) {
  return <div><span>{label}</span><p>{value}</p></div>;
}

function IssueForm({ stop, onCancel, onSaved }) {
  const [form, setForm] = useState({
    type: "service",
    description: "",
    customerApproved: "",
    additionalCharge: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/bookings/${stop.bookingId}/issues`, {
        type: form.type,
        description: form.description,
        customerApproved: form.customerApproved === "" ? null : form.customerApproved === "true",
        additionalChargeCents: form.additionalCharge ? cents(form.additionalCharge) : null
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Issue type">
        <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
          <option value="access">Access</option><option value="damage">Damage</option><option value="safety">Safety</option>
          <option value="extra_work">Extra work</option><option value="service">Service</option><option value="other">Other</option>
        </select>
      </Field>
      <Field label="Description"><textarea required rows="4" maxLength="2000" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
      <div className="form-grid">
        <Field label="Customer approved">
          <select value={form.customerApproved} onChange={(event) => setForm({ ...form, customerApproved: event.target.value })}>
            <option value="">Not applicable</option><option value="true">Yes</option><option value="false">No</option>
          </select>
        </Field>
        <Field label="Additional charge">
          <input min="0" step="0.01" type="number" value={form.additionalCharge} onChange={(event) => setForm({ ...form, additionalCharge: event.target.value })} />
        </Field>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="Report issue" />
    </form>
  );
}

function PayrollPage() {
  const [periodId, setPeriodId] = useState(() => window.localStorage.getItem("qcm_payroll_period") || "");
  const [startsOn, setStartsOn] = useState(mondayFor(new Date()));
  const [tab, setTab] = useState("week1");
  const [entryModal, setEntryModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const [working, setWorking] = useState(false);
  const history = useLoad(() => api.get("/payroll-periods"), []);
  const resource = useLoad(
    () => periodId ? api.get(`/payroll-periods/${periodId}`) : Promise.resolve(null),
    [periodId]
  );
  const payrollPeriods = history.data?.payrollPeriods || [];
  const period = resource.data?.payrollPeriod;

  useEffect(() => {
    if (history.status !== "ready") return;
    const selectedExists = payrollPeriods.some((item) => item.id === periodId);
    if (payrollPeriods.length && !selectedExists) {
      const id = payrollPeriods[0].id;
      window.localStorage.setItem("qcm_payroll_period", id);
      setPeriodId(id);
    } else if (!payrollPeriods.length && periodId) {
      window.localStorage.removeItem("qcm_payroll_period");
      setPeriodId("");
    }
  }, [history.status, periodId, payrollPeriods]);

  function remember(id) {
    window.localStorage.setItem("qcm_payroll_period", id);
    setPeriodId(id);
    setTab("week1");
  }

  async function generate(event) {
    event.preventDefault();
    if (!isMonday(startsOn)) {
      setNotice({ type: "error", message: "The pay period must start on a Monday." });
      return;
    }
    setWorking(true);
    setNotice(null);
    try {
      const result = await api.post("/payroll-periods", { startsOn });
      remember(result.payrollPeriod.id);
      history.reload();
      setNotice({ message: "Payroll period generated for review." });
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    } finally {
      setWorking(false);
    }
  }

  async function approve() {
    setWorking(true);
    try {
      const result = await api.post(`/payroll-periods/${period.id}/approve`);
      resource.setState({ status: "ready", data: result, error: "" });
      history.reload();
      setNotice({ message: "Payroll approved." });
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    } finally {
      setWorking(false);
    }
  }

  async function exportPayroll() {
    setWorking(true);
    try {
      const result = await api.post(`/payroll-periods/${period.id}/exports`);
      downloadCsv(result.payrollExport);
      setNotice({ message: `Payroll export version ${result.payrollExport.version} created.` });
      resource.reload();
      history.reload();
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Two-week payroll"
        title="Payroll"
      >
        {period?.status === "review" && <button className="primary-button inline-button" disabled={working} type="button" onClick={approve}>Approve payroll</button>}
        {["approved", "exported"].includes(period?.status) && <button className="primary-button inline-button" disabled={working} type="button" onClick={exportPayroll}>Create CSV export</button>}
      </PageHeader>
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <section className="section-block">
        <form className="payroll-create-bar" onSubmit={generate}>
          <Field label="Pay period starts Monday">
            <input required type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
          </Field>
          <button className="secondary-button" disabled={working} type="submit">
            {working ? "Generating..." : "Generate payroll"}
          </button>
        </form>

        {(history.status === "loading" || resource.status === "loading") && <LoadingRows />}
        {history.status === "error" && <StatePanel title="Payroll history unavailable" message={history.error} action={<button className="secondary-button" type="button" onClick={history.reload}>Retry</button>} />}
        {resource.status === "error" && payrollPeriods.length > 0 && <StatePanel title="Payroll unavailable" message={resource.error} />}
        {history.status === "ready" && payrollPeriods.length === 0 && resource.status === "error" && (
          <StatePanel title="No payroll selected" message="Generate a two-week payroll period to begin." />
        )}
        {resource.status === "ready" && !period && <StatePanel title="No payroll selected" message="Generate a two-week payroll period to begin." />}
        {resource.status === "ready" && period && (
          <div className="payroll-workspace">
            <div className="payroll-period-heading">
              <div>
                <p className="eyebrow">Current pay period</p>
                <h2>{shortDate(period.startsOn)} - {shortDate(period.endsOn)}</h2>
              </div>
              <StatusBadge status={period.status} />
            </div>

            <div className="payroll-tabs" role="tablist" aria-label="Payroll views">
              {[
                ["week1", "Week 1"],
                ["week2", "Week 2"],
                ["report", "Payroll Report"]
              ].map(([value, label]) => (
                <button
                  aria-selected={tab === value}
                  className={tab === value ? "active" : ""}
                  key={value}
                  role="tab"
                  type="button"
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab !== "report" ? (
              <PayrollWeek
                period={period}
                weekIndex={tab === "week1" ? 0 : 1}
                onAdd={() => setEntryModal({ weekIndex: tab === "week1" ? 0 : 1 })}
                onEdit={(entry) => setEntryModal({ entry })}
              />
            ) : (
              <PayrollReport period={period} />
            )}
          </div>
        )}
      </section>

      <section className="section-block">
        <SectionHeader eyebrow="Records" title="Payroll history" count={payrollPeriods.length} />
        {history.status === "ready" && payrollPeriods.length === 0 && (
          <StatePanel title="No past payrolls" message="Generated payroll periods will be stored here." />
        )}
        {history.status === "ready" && payrollPeriods.length > 0 && (
          <div className="data-table payroll-history-table">
            <div className="data-row data-head">
              <span>Payroll weeks</span><span>Status</span><span>Employees</span><span>Total hours</span><span>Gross wages</span><span />
            </div>
            {payrollPeriods.map((item) => (
              <article className="data-row" key={item.id}>
                <div data-label="Payroll weeks"><strong>{shortDate(item.startsOn)} - {shortDate(item.endsOn)}</strong></div>
                <div data-label="Status"><StatusBadge status={item.status} /></div>
                <div data-label="Employees">{item.employeeCount}</div>
                <div data-label="Total hours">{hours(item.totalMinutes)}</div>
                <div data-label="Gross wages"><strong>{money(item.grossWagesCents)}</strong></div>
                <div data-label="Action">
                  <button className="text-button" type="button" onClick={() => remember(item.id)}>
                    {item.id === periodId ? "Opened" : "Open"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {entryModal && period && (
        <Modal
          title={entryModal.entry ? "Employee hours" : "Add employee hours"}
          onClose={() => setEntryModal(null)}
        >
          <PayrollHoursForm
            entry={entryModal.entry}
            period={period}
            weekIndex={entryModal.weekIndex}
            onCancel={() => setEntryModal(null)}
            onSaved={(message) => {
              setEntryModal(null);
              setNotice({ message });
              resource.reload();
              history.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}

function PayrollWeek({ period, weekIndex, onAdd, onEdit }) {
  const weekStartsOn = shiftDate(period.startsOn, weekIndex * 7);
  const weekEndsOn = shiftDate(weekStartsOn, 4);
  const lines = period.lines.filter((line) => String(line.weekStartsOn).slice(0, 10) === weekStartsOn);
  const days = payrollWeekdays(weekStartsOn);
  const entries = new Map((period.dayEntries || []).map((entry) => [
    `${entry.employeeId}:${String(entry.workDate).slice(0, 10)}`,
    entry
  ]));

  return (
    <section aria-labelledby={`payroll-week-${weekIndex + 1}`} role="tabpanel">
      <div className="payroll-view-toolbar">
        <div>
          <h3 id={`payroll-week-${weekIndex + 1}`}>Week {weekIndex + 1}</h3>
          <p>{shortDate(weekStartsOn)} - {shortDate(weekEndsOn)}</p>
        </div>
        {period.status === "review" && (
          <button className="primary-button inline-button" type="button" onClick={onAdd}>
            Add employee hours
          </button>
        )}
      </div>

      {lines.length === 0 ? (
        <StatePanel title="No employees in this week" message="Active employees will appear when the payroll period is generated." />
      ) : (
        <div className="payroll-week-scroll">
          <table className="payroll-week-table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                {days.map((day) => <th scope="col" key={day.date}>{day.name}</th>)}
                <th scope="col">Total Hours</th>
                <th scope="col">Tips</th>
                <th scope="col">Wages</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <th scope="row">
                    <strong>{line.employeeName}</strong>
                    <small>{money(line.hourlyRateCents)}/hr{line.captainDays > 0 ? ` | Captain ${line.captainDays} day${line.captainDays === 1 ? "" : "s"}` : ""}</small>
                  </th>
                  {days.map((day) => {
                    const entry = entries.get(`${line.employeeId}:${day.date}`);
                    return (
                      <td key={day.date}>
                        {entry ? (
                          <button
                            aria-label={`Edit ${line.employeeName} hours for ${day.name}`}
                            className="payroll-day-button"
                            type="button"
                            onClick={() => onEdit(entry)}
                          >
                            <strong>{hours(entry.paidMinutes)}</strong>
                            <small>{payrollTime(entry.checkInTime)} - {payrollTime(entry.checkOutTime)}</small>
                          </button>
                        ) : <span className="payroll-empty-day">-</span>}
                      </td>
                    );
                  })}
                  <td><strong>{hours(line.regularMinutes + line.overtimeMinutes)}</strong></td>
                  <td>{money(line.tipsCents)}</td>
                  <td><strong>{money(line.grossWagesCents)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PayrollReport({ period }) {
  const rows = payrollReportRows(period.lines);

  return (
    <section aria-labelledby="payroll-report-title" role="tabpanel">
      <div className="payroll-view-toolbar">
        <div>
          <h3 id="payroll-report-title">Payroll Report</h3>
          <p>{shortDate(period.startsOn)} - {shortDate(period.endsOn)}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <StatePanel title="No worked hours" message="Employees with recorded hours will appear in this report." />
      ) : (
        <div className="payroll-week-scroll">
          <table className="payroll-report-table">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Total Hours</th>
                <th scope="col">Tips</th>
                <th scope="col">Captain Pay</th>
                <th scope="col">Total Wages</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employeeId}>
                  <th scope="row"><strong>{row.employeeName}</strong></th>
                  <td>{hours(row.totalMinutes)}</td>
                  <td>{money(row.tipsCents)}</td>
                  <td>{money(row.captainReimbursementCents)}</td>
                  <td><strong>{money(row.grossWagesCents)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Pay period total</th>
                <td>{hours(rows.reduce((sum, row) => sum + row.totalMinutes, 0))}</td>
                <td>{money(rows.reduce((sum, row) => sum + row.tipsCents, 0))}</td>
                <td>{money(rows.reduce((sum, row) => sum + row.captainReimbursementCents, 0))}</td>
                <td><strong>{money(rows.reduce((sum, row) => sum + row.grossWagesCents, 0))}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function PayrollHoursForm({ entry, period, weekIndex = 0, onCancel, onSaved }) {
  const employees = payrollEmployees(period.lines);
  const dates = payrollWeekdays(shiftDate(period.startsOn, weekIndex * 7));
  const [form, setForm] = useState({
    employeeId: entry?.employeeId || employees[0]?.id || "",
    workDate: String(entry?.workDate || dates[0]?.date || period.startsOn).slice(0, 10),
    checkInTime: String(entry?.checkInTime || "").slice(0, 5),
    checkOutTime: String(entry?.checkOutTime || "").slice(0, 5),
    tips: entry ? (Number(entry.tipsCents || 0) / 100).toFixed(2) : ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const locked = period.status !== "review";
  const previewMinutes = payrollMinutes(form.checkInTime, form.checkOutTime);

  async function submit(event) {
    event.preventDefault();
    if (previewMinutes <= 0) {
      setError("Check-out must be later than check-in.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post(`/payroll-periods/${period.id}/days`, {
        employeeId: form.employeeId,
        workDate: form.workDate,
        checkInTime: form.checkInTime,
        checkOutTime: form.checkOutTime,
        tipsCents: cents(form.tips)
      });
      onSaved(entry ? "Employee hours updated." : "Employee hours added.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this employee's hours for the selected day?")) return;
    setSaving(true);
    setError("");
    try {
      await api.remove(`/payroll-periods/${period.id}/days/${entry.id}`);
      onSaved("Employee hours deleted.");
    } catch (requestError) {
      setError(errorMessage(requestError));
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Employee">
          <select
            disabled={Boolean(entry) || locked}
            required
            value={form.employeeId}
            onChange={(event) => setForm({ ...form, employeeId: event.target.value })}
          >
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </select>
        </Field>
        <Field label="Work date">
          {entry ? (
            <input disabled value={form.workDate} />
          ) : (
            <select disabled={locked} required value={form.workDate} onChange={(event) => setForm({ ...form, workDate: event.target.value })}>
              {dates.map((day) => <option key={day.date} value={day.date}>{day.name}, {shortDate(day.date)}</option>)}
            </select>
          )}
        </Field>
      </div>
      <div className="form-grid">
        <Field label="First-house check-in">
          <input disabled={locked} required type="time" value={form.checkInTime} onChange={(event) => setForm({ ...form, checkInTime: event.target.value })} />
        </Field>
        <Field label="Last-house check-out">
          <input disabled={locked} required type="time" value={form.checkOutTime} onChange={(event) => setForm({ ...form, checkOutTime: event.target.value })} />
        </Field>
      </div>
      <Field label="Tips">
        <input disabled={locked} min="0" step="0.01" type="number" value={form.tips} onChange={(event) => setForm({ ...form, tips: event.target.value })} />
      </Field>
      <div className="payroll-hours-preview" aria-live="polite">
        <span>Calculated hours</span>
        <strong>{previewMinutes > 0 ? hours(previewMinutes) : "0.00 hr"}</strong>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {locked ? (
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>Close</button>
        </div>
      ) : (
        <div className="payroll-form-actions">
          <div>
            {entry && <button className="danger-button" disabled={saving} type="button" onClick={remove}>Delete entry</button>}
          </div>
          <FormActions saving={saving} onCancel={onCancel} submitLabel={entry ? "Save changes" : "Add hours"} />
        </div>
      )}
    </form>
  );
}

function payrollWeekdays(weekStartsOn) {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name, index) => ({
    name,
    date: shiftDate(weekStartsOn, index)
  }));
}

function payrollEmployees(lines = []) {
  return [...new Map(lines.map((line) => [
    line.employeeId,
    { id: line.employeeId, name: line.employeeName }
  ])).values()].sort((left, right) => left.name.localeCompare(right.name));
}

function payrollReportRows(lines = []) {
  const employees = new Map();
  for (const line of lines) {
    const row = employees.get(line.employeeId) || {
      employeeId: line.employeeId,
      employeeName: line.employeeName,
      totalMinutes: 0,
      tipsCents: 0,
      captainReimbursementCents: 0,
      grossWagesCents: 0
    };
    row.totalMinutes += Number(line.regularMinutes || 0) + Number(line.overtimeMinutes || 0);
    row.tipsCents += Number(line.tipsCents || 0);
    row.captainReimbursementCents += Number(line.captainReimbursementCents || 0);
    row.grossWagesCents += Number(line.grossWagesCents || 0);
    employees.set(line.employeeId, row);
  }
  return [...employees.values()]
    .filter((row) => row.totalMinutes > 0)
    .sort((left, right) => left.employeeName.localeCompare(right.employeeName));
}

function payrollMinutes(checkInTime, checkOutTime) {
  if (!checkInTime || !checkOutTime) return 0;
  const [startHour, startMinute] = checkInTime.split(":").map(Number);
  const [endHour, endMinute] = checkOutTime.split(":").map(Number);
  return Math.max(0, (endHour * 60 + endMinute) - (startHour * 60 + startMinute));
}

function payrollTime(value) {
  if (!value) return "-";
  const [hour, minute] = String(value).slice(0, 5).split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function isMonday(value) {
  return new Date(`${value}T12:00:00`).getDay() === 1;
}

function MessagesPage() {
  const [tab, setTab] = useState("outbound");
  const [status, setStatus] = useState("");
  const [compose, setCompose] = useState(false);
  const [notice, setNotice] = useState(null);
  const resource = useLoad(
    () => tab === "outbound"
      ? api.get("/notifications", { status })
      : api.get("/inbound-messages"),
    [tab, status]
  );
  const notifications = resource.data?.notifications || [];
  const inboundMessages = resource.data?.messages || [];

  async function sendDue() {
    try {
      const result = await api.post("/notifications/send-due");
      setNotice({ message: `${result.processed} queued message${result.processed === 1 ? "" : "s"} processed.` });
      resource.reload();
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  async function cancel(id) {
    try {
      await api.post(`/notifications/${id}/cancel`);
      setNotice({ message: "Message cancelled." });
      resource.reload();
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  async function retry(id) {
    try {
      await api.post(`/notifications/${id}/retry`);
      setNotice({ message: "Message queued for another delivery attempt." });
      resource.reload();
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  return (
    <>
      <PageHeader eyebrow="Customer communication" title="Messages" description="Queued, sent, failed, and cancelled customer text messages.">
        {tab === "outbound" && (
          <>
            <button className="secondary-button" type="button" onClick={() => setCompose(true)}>Compose message</button>
            <button className="primary-button inline-button" type="button" onClick={sendDue}>Send due messages</button>
          </>
        )}
      </PageHeader>
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <section className="section-block message-tabs">
        <div className="segmented-control" role="tablist" aria-label="Message views">
          <button aria-selected={tab === "outbound"} className={tab === "outbound" ? "active" : ""} role="tab" type="button" onClick={() => setTab("outbound")}>Outbound</button>
          <button aria-selected={tab === "inbound"} className={tab === "inbound" ? "active" : ""} role="tab" type="button" onClick={() => setTab("inbound")}>Inbox</button>
        </div>
      </section>
      {tab === "outbound" && (
        <section className="section-block" role="tabpanel">
          <div className="toolbar">
            <select aria-label="Filter message status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option><option value="queued">Queued</option><option value="sent">Sent</option>
              <option value="delivered">Delivered</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option>
            </select>
            <button className="secondary-button" type="button" onClick={resource.reload}>Refresh</button>
          </div>
          {resource.status === "loading" && <LoadingRows />}
          {resource.status === "error" && <StatePanel title="Messages unavailable" message={resource.error} />}
          {resource.status === "ready" && resource.data?.providerConfigured === false && (
            <StatePanel title="Text provider is not configured" message="Queued messages are retained, but they cannot be delivered until the business SMS provider is connected." />
          )}
          {resource.status === "ready" && notifications.length === 0 && <StatePanel title="No messages" message="There are no notifications matching this status." />}
          {resource.status === "ready" && notifications.length > 0 && (
            <div className="data-table message-table">
              <div className="data-row data-head"><span>Type</span><span>Destination</span><span>Message</span><span>Due</span><span>Status</span><span>Actions</span></div>
              {notifications.map((notification) => (
                <article className="data-row" key={notification.id}>
                  <div data-label="Type">{capitalize(notification.type.replaceAll("_", " "))}</div>
                  <div data-label="Destination">
                    <strong>{notification.customerName || notification.destination}</strong>
                    {notification.customerName && <small>{notification.destination}</small>}
                  </div>
                  <div className="message-body" data-label="Message">{notification.body}<small>{notification.failureReason}</small></div>
                  <div data-label="Due">{dateTime(notification.dueAt)}</div>
                  <div data-label="Status"><StatusBadge status={notification.status} /></div>
                  <div className="row-actions" data-label="Actions">
                    {notification.status === "queued" && <button className="text-button danger-text" type="button" onClick={() => cancel(notification.id)}>Cancel</button>}
                    {notification.status === "failed" && <button className="text-button" type="button" onClick={() => retry(notification.id)}>Retry</button>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {tab === "inbound" && (
        <section className="section-block" role="tabpanel">
          <SectionHeader eyebrow="Customer replies" title="Inbox" count={resource.status === "ready" ? inboundMessages.length : undefined} />
          {resource.status === "loading" && <LoadingRows />}
          {resource.status === "error" && <StatePanel title="Inbox unavailable" message={resource.error} />}
          {resource.status === "ready" && inboundMessages.length === 0 && <StatePanel title="No inbound messages" message="Customer replies will appear here after the SMS provider is connected." />}
          {resource.status === "ready" && inboundMessages.length > 0 && (
            <div className="data-table inbound-message-table">
              <div className="data-row data-head"><span>Customer</span><span>Message</span><span>Received</span><span>Consent event</span></div>
              {inboundMessages.map((message) => (
                <article className="data-row" key={message.id}>
                  <div data-label="Customer"><strong>{message.customerName || "Unknown number"}</strong><small>{message.fromPhone}</small></div>
                  <div data-label="Message">{message.body || "(No message body)"}</div>
                  <div data-label="Received">{dateTime(message.receivedAt)}</div>
                  <div data-label="Consent event">{message.optOutType || "-"}</div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {compose && (
        <Modal title="Compose customer text" onClose={() => setCompose(false)}>
          <ComposeMessageForm
            onCancel={() => setCompose(false)}
            onSaved={() => {
              setCompose(false);
              setNotice({ message: "Customer message queued." });
              resource.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}

function ComposeMessageForm({ onCancel, onSaved }) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const customers = useLoad(() => api.list("customers", {
    status: "active",
    q: debouncedSearch,
    limit: 20
  }), [debouncedSearch]);
  const [customerId, setCustomerId] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/customers/${customerId}/messages`, {
        body,
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {})
      });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="Find customer">
        <input placeholder="Search name, phone, or email" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </Field>
      <Field label="Customer">
        <select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
          <option value="">Select customer</option>
          {(customers.data?.customers || []).map((customer) => (
            <option key={customer.id} value={customer.id}>{customer.name} - {customer.phone}</option>
          ))}
        </select>
      </Field>
      <Field label="Message" hint={`${body.length}/1600`}>
        <textarea required maxLength="1600" rows="5" value={body} onChange={(event) => setBody(event.target.value)} />
      </Field>
      <Field label="Send at" hint="Leave blank to send now">
        <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="Queue message" />
    </form>
  );
}

function ReportsPage() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const previousMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const initialFinancial = {
    kind: "monthly",
    from: localDate(monthStart),
    to: localDate(today),
    payrollPeriodId: ""
  };
  const initialComparison = {
    fromA: localDate(previousMonthStart),
    toA: localDate(previousMonthEnd),
    fromB: localDate(monthStart),
    toB: localDate(today)
  };
  const [tab, setTab] = useState("financial");
  const [financialForm, setFinancialForm] = useState(initialFinancial);
  const [financialQuery, setFinancialQuery] = useState(initialFinancial);
  const [comparisonForm, setComparisonForm] = useState(initialComparison);
  const [comparisonQuery, setComparisonQuery] = useState(initialComparison);
  const [expenseModal, setExpenseModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const periodsResource = useLoad(() => api.get("/payroll-periods"), []);
  const financial = useLoad(
    () => api.get("/reports/financial", financialQuery),
    [financialQuery.kind, financialQuery.from, financialQuery.to, financialQuery.payrollPeriodId]
  );
  const expenses = useLoad(
    () => api.get("/expenses", { from: financialQuery.from, to: financialQuery.to }),
    [financialQuery.from, financialQuery.to]
  );
  const comparison = useLoad(
    () => api.get("/reports/compare", comparisonQuery),
    [comparisonQuery.fromA, comparisonQuery.toA, comparisonQuery.fromB, comparisonQuery.toB]
  );
  const payrollPeriods = periodsResource.data?.payrollPeriods || [];
  const report = financial.data || {};
  const finances = report.finances || {};
  const services = report.services || {};
  const expenseRows = expenses.data?.expenses || [];

  function selectReportKind(kind) {
    if (kind === "yearly") {
      setFinancialForm({ kind, from: `${today.getFullYear()}-01-01`, to: localDate(today), payrollPeriodId: "" });
      return;
    }
    if (kind === "monthly") {
      setFinancialForm({ kind, from: localDate(monthStart), to: localDate(today), payrollPeriodId: "" });
      return;
    }
    const period = payrollPeriods[0];
    setFinancialForm({
      kind,
      from: period?.startsOn || mondayFor(today),
      to: period?.endsOn || shiftDate(mondayFor(today), 13),
      payrollPeriodId: period?.id || ""
    });
  }

  function selectPayrollPeriod(id) {
    const period = payrollPeriods.find((item) => item.id === id);
    setFinancialForm((current) => ({
      ...current,
      payrollPeriodId: id,
      ...(period ? { from: period.startsOn, to: period.endsOn } : {})
    }));
  }

  function refreshFinancial(message) {
    setExpenseModal(null);
    setNotice({ message });
    financial.reload();
    expenses.reload();
  }

  return (
    <>
      <PageHeader eyebrow="Business performance" title="Reports" description="Financial results, operating expenses, customer retention, and period comparisons.">
        {tab === "financial" && <button className="primary-button inline-button" type="button" onClick={() => setExpenseModal({})}>Record expense</button>}
      </PageHeader>
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <section className="section-block report-tabs">
        <div className="segmented-control" role="tablist" aria-label="Report views">
          {[
            ["financial", "Financial reports"],
            ["analytics", "Analytics"]
          ].map(([value, label]) => (
            <button
              aria-selected={tab === value}
              className={tab === value ? "active" : ""}
              key={value}
              role="tab"
              type="button"
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {tab === "financial" && (
        <>
          <section className="section-block" role="tabpanel">
            <form className="report-toolbar financial-report-toolbar" onSubmit={(event) => {
              event.preventDefault();
              setFinancialQuery(financialForm);
            }}>
              <Field label="Report type">
                <select value={financialForm.kind} onChange={(event) => selectReportKind(event.target.value)}>
                  <option value="payroll">Payroll period</option>
                  <option value="monthly">End of month</option>
                  <option value="yearly">End of year</option>
                </select>
              </Field>
              {financialForm.kind === "payroll" && (
                <Field label="Payroll period">
                  <select required value={financialForm.payrollPeriodId} onChange={(event) => selectPayrollPeriod(event.target.value)}>
                    <option value="">Select a payroll period</option>
                    {payrollPeriods.map((period) => (
                      <option key={period.id} value={period.id}>{shortDate(period.startsOn)} - {shortDate(period.endsOn)}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="From"><input required type="date" value={financialForm.from} onChange={(event) => setFinancialForm({ ...financialForm, from: event.target.value, payrollPeriodId: "" })} /></Field>
              <Field label="To"><input required type="date" value={financialForm.to} onChange={(event) => setFinancialForm({ ...financialForm, to: event.target.value, payrollPeriodId: "" })} /></Field>
              <button className="primary-button inline-button" type="submit">Generate report</button>
            </form>
            {financial.status === "loading" && <LoadingRows />}
            {financial.status === "error" && <StatePanel title="Financial report unavailable" message={financial.error} action={<button className="text-button" onClick={financial.reload}>Try again</button>} />}
            {financial.status === "ready" && (
              <>
                <div className="report-period-label">
                  <span>{capitalize(report.kind || financialQuery.kind)} report</span>
                  <strong>{shortDate(report.range?.from || financialQuery.from)} - {shortDate(report.range?.to || financialQuery.to)}</strong>
                </div>
                <div className="metric-grid report-metrics financial-metrics">
                  <Metric label="Revenue collected" value={money(finances.revenueCents)} />
                  <Metric label="Total expenses" value={money(finances.totalExpensesCents)} />
                  <Metric label="Net profit" value={money(finances.profitCents)} warning={Number(finances.profitCents) < 0} />
                  <Metric label="Outstanding" value={money(finances.outstandingCents)} warning={Number(finances.outstandingCents) > 0} />
                  <Metric label="Services" value={services.total} />
                  <Metric label="Collection rate" value={percentage(finances.collectionRate)} />
                  <Metric label="Average revenue per service" value={money(finances.averageRevenuePerServiceCents)} />
                </div>
              </>
            )}
          </section>

          {financial.status === "ready" && (
            <section className="section-block report-detail-grid">
              <div>
                <SectionHeader eyebrow="Services" title="Service mix" count={services.byType?.length || 0} />
                {!services.byType?.length ? <StatePanel title="No services" message="No completed services fall within this report period." /> : (
                  <div className="data-table service-mix-table">
                    <div className="data-row data-head"><span>Service type</span><span>Services</span><span>Revenue</span></div>
                    {services.byType.map((service) => (
                      <article className="data-row" key={service.serviceName}>
                        <div data-label="Service type"><strong>{service.serviceName}</strong></div>
                        <div data-label="Services">{service.count}</div>
                        <div data-label="Revenue">{money(service.revenueCents)}</div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <SectionHeader eyebrow="Costs" title="Expense breakdown" count={report.expenseBreakdown?.length || 0} />
                {!report.expenseBreakdown?.length ? <StatePanel title="No expenses" message="Payroll wages and recorded operating expenses will appear here." /> : (
                  <div className="data-table expense-breakdown-table">
                    <div className="data-row data-head"><span>Category</span><span>Amount</span></div>
                    {report.expenseBreakdown.map((expense) => (
                      <article className="data-row" key={expense.category}>
                        <div data-label="Category"><strong>{capitalize(expense.category.replaceAll("_", " "))}</strong></div>
                        <div data-label="Amount">{money(expense.amountCents)}</div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {financial.status === "ready" && financialQuery.kind !== "payroll" && report.retention && (
            <section className="section-block">
              <SectionHeader eyebrow="Customers" title="Retention" />
              <div className="metric-grid retention-metrics">
                <Metric label="Eligible customers" value={report.retention.eligibleCustomers} />
                <Metric label="Retained customers" value={report.retention.retainedCustomers} />
                <Metric label="Retention rate" value={percentage(report.retention.retentionRate)} />
              </div>
            </section>
          )}

          <section className="section-block">
            <SectionHeader eyebrow="Operating costs" title="Recorded expenses" count={expenses.status === "ready" ? expenseRows.length : undefined} />
            {expenses.status === "loading" && <LoadingRows />}
            {expenses.status === "error" && <StatePanel title="Expenses unavailable" message={expenses.error} />}
            {expenses.status === "ready" && expenseRows.length === 0 && <StatePanel title="No operating expenses" message="Supplies, fuel, equipment, software, and other costs for this period will appear here." />}
            {expenses.status === "ready" && expenseRows.length > 0 && (
              <div className="data-table expense-record-table">
                <div className="data-row data-head"><span>Date</span><span>Category</span><span>Description</span><span>Amount</span><span>Status</span><span>Actions</span></div>
                {expenseRows.map((expense, index) => (
                  <article className="data-row" key={expense.id || `${expense.spentOn}-${index}`}>
                    <div data-label="Date">{shortDate(expense.spentOn)}</div>
                    <div data-label="Category">{capitalize(expense.category.replaceAll("_", " "))}</div>
                    <div data-label="Description"><strong>{expense.description}</strong>{expense.voidReason && <small>{expense.voidReason}</small>}</div>
                    <div data-label="Amount"><strong>{money(expense.amountCents)}</strong></div>
                    <div data-label="Status"><StatusBadge status={expense.status} /></div>
                    <div className="row-actions" data-label="Actions">
                      {expense.status === "recorded" ? (
                        <>
                          <button className="text-button" type="button" onClick={() => setExpenseModal({ expense })}>Edit</button>
                          <button className="text-button danger-text" type="button" onClick={async () => {
                            const reason = window.prompt("Why should this expense be voided?");
                            if (!reason?.trim()) return;
                            try {
                              await api.post(`/expenses/${expense.id}/void`, { reason: reason.trim() });
                              refreshFinancial("Expense voided.");
                            } catch (error) {
                              setNotice({ type: "error", message: errorMessage(error) });
                            }
                          }}>Void</button>
                        </>
                      ) : <span className="muted">Corrected</span>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {tab === "analytics" && (
        <section className="section-block" role="tabpanel">
          <form className="comparison-toolbar" onSubmit={(event) => {
            event.preventDefault();
            setComparisonQuery(comparisonForm);
          }}>
            <fieldset>
              <legend>Period A</legend>
              <Field label="From"><input required type="date" value={comparisonForm.fromA} onChange={(event) => setComparisonForm({ ...comparisonForm, fromA: event.target.value })} /></Field>
              <Field label="To"><input required type="date" value={comparisonForm.toA} onChange={(event) => setComparisonForm({ ...comparisonForm, toA: event.target.value })} /></Field>
            </fieldset>
            <fieldset>
              <legend>Period B</legend>
              <Field label="From"><input required type="date" value={comparisonForm.fromB} onChange={(event) => setComparisonForm({ ...comparisonForm, fromB: event.target.value })} /></Field>
              <Field label="To"><input required type="date" value={comparisonForm.toB} onChange={(event) => setComparisonForm({ ...comparisonForm, toB: event.target.value })} /></Field>
            </fieldset>
            <button className="primary-button inline-button" type="submit">Compare periods</button>
          </form>
          {comparison.status === "loading" && <LoadingRows />}
          {comparison.status === "error" && <StatePanel title="Comparison unavailable" message={comparison.error} />}
          {comparison.status === "ready" && comparison.data && (
            <>
              <div className={`trend-summary trend-${comparison.data.trend}`}>
                <div>
                  <span>Business trend</span>
                  <strong>{capitalize(comparison.data.trend)}</strong>
                </div>
                <p>Period A: {shortDate(comparison.data.periodA?.range?.from || comparisonQuery.fromA)} - {shortDate(comparison.data.periodA?.range?.to || comparisonQuery.toA)}<br />
                  Period B: {shortDate(comparison.data.periodB?.range?.from || comparisonQuery.fromB)} - {shortDate(comparison.data.periodB?.range?.to || comparisonQuery.toB)}</p>
              </div>
              <SectionHeader eyebrow="Period comparison" title="Financial and service changes" />
              <ComparisonTable comparison={comparison.data.comparison || {}} />
            </>
          )}
        </section>
      )}

      {expenseModal && (
        <Modal
          title={expenseModal.expense ? "Edit expense" : "Record expense"}
          description={expenseModal.expense ? "Correct the recorded operating cost." : "Add an operating cost to financial reporting."}
          onClose={() => setExpenseModal(null)}
        >
          <ExpenseForm
            expense={expenseModal.expense}
            defaultDate={financialQuery.to}
            onCancel={() => setExpenseModal(null)}
            onSaved={() => refreshFinancial(
              expenseModal.expense ? "Expense updated." : "Expense recorded."
            )}
          />
        </Modal>
      )}
    </>
  );
}

function ComparisonTable({ comparison }) {
  const definitions = [
    ["revenueCents", "Revenue", "money"],
    ["expensesCents", "Expenses", "money"],
    ["profitCents", "Profit", "money"],
    ["services", "Services", "number"],
    ["averageRevenuePerServiceCents", "Average revenue per service", "money"],
    ["collectionRate", "Collection rate", "percent"]
  ];

  function display(value, type) {
    if (type === "money") return money(value);
    if (type === "percent") return percentage(value);
    return Number(value ?? 0).toLocaleString();
  }

  return (
    <div className="data-table comparison-table">
      <div className="data-row data-head"><span>Metric</span><span>Period A</span><span>Period B</span><span>Change</span><span>Percent change</span></div>
      {definitions.map(([key, label, type]) => {
        const metric = comparison[key] || {};
        const changeClass = Number(metric.change) > 0 ? "positive-change" : Number(metric.change) < 0 ? "negative-change" : "";
        return (
          <article className="data-row" key={key}>
            <div data-label="Metric"><strong>{label}</strong></div>
            <div data-label="Period A">{display(metric.a, type)}</div>
            <div data-label="Period B">{display(metric.b, type)}</div>
            <div className={changeClass} data-label="Change">{display(metric.change, type)}</div>
            <div className={changeClass} data-label="Percent change">{percentage(metric.percentChange, true)}</div>
          </article>
        );
      })}
    </div>
  );
}

function ExpenseForm({ defaultDate, expense, onCancel, onSaved }) {
  const [form, setForm] = useState({
    spentOn: expense?.spentOn || defaultDate || localDate(),
    category: expense?.category || "supplies",
    description: expense?.description || "",
    amount: expense ? (Number(expense.amountCents) / 100).toFixed(2) : ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        spentOn: form.spentOn,
        category: form.category,
        description: form.description,
        amountCents: cents(form.amount)
      };
      if (expense) await api.patch(`/expenses/${expense.id}`, payload);
      else await api.post("/expenses", payload);
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Date"><input required type="date" value={form.spentOn} onChange={(event) => setForm({ ...form, spentOn: event.target.value })} /></Field>
        <Field label="Category">
          <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
            <option value="supplies">Supplies</option>
            <option value="fuel">Fuel</option>
            <option value="equipment">Equipment</option>
            <option value="software">Software</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Amount"><input required min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field>
      </div>
      <Field label="Description"><input required maxLength="500" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={expense ? "Save expense" : "Record expense"} />
    </form>
  );
}

function SettingsPage() {
  const [tab, setTab] = useState("business");
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Business rules, staff accounts, and validated data imports."
      />
      <section className="section-block settings-tabs">
        <div className="segmented-control" aria-label="Settings views">
          {[
            ["business", "Business"],
            ["services", "Services"],
            ["accounts", "Accounts"],
            ["history", "Activity"],
            ["security", "Security"],
            ["imports", "Imports"]
          ].map(([value, label]) => (
            <button
              aria-pressed={tab === value}
              className={tab === value ? "active" : ""}
              key={value}
              type="button"
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      {tab === "business" && <BusinessSettingsPanel />}
      {tab === "services" && <ServiceTypesPanel />}
      {tab === "accounts" && <AccountsPanel />}
      {tab === "history" && <AuditHistoryPanel />}
      {tab === "security" && <SecurityPanel />}
      {tab === "imports" && <ImportsPanel />}
    </>
  );
}

function BusinessSettingsPanel() {
  const resource = useLoad(() => api.settings(), []);
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!resource.data?.settings) return;
    const settings = resource.data.settings;
    setForm({
      responseTargetMinutes: settings.responseTargetMinutes,
      hourlyTeamRate: (settings.hourlyTeamRateCents / 100).toFixed(2),
      lateCancellationFee: (settings.lateCancellationFeeCents / 100).toFixed(2),
      captainReimbursement: (settings.captainReimbursementCents / 100).toFixed(2),
      routeWarningMinutes: settings.routeWarningMinutes,
      routeWarningEndTime: settings.routeWarningEndTime?.slice(0, 5) || "",
      quoteReviewDays: settings.quoteReviewDays,
      paymentReminderDays: settings.paymentReminderDays
    });
  }, [resource.data]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const result = await api.patch("/settings", {
        responseTargetMinutes: Number(form.responseTargetMinutes),
        hourlyTeamRateCents: cents(form.hourlyTeamRate),
        lateCancellationFeeCents: cents(form.lateCancellationFee),
        captainReimbursementCents: cents(form.captainReimbursement),
        routeWarningMinutes: Number(form.routeWarningMinutes),
        routeWarningEndTime: form.routeWarningEndTime,
        quoteReviewDays: Number(form.quoteReviewDays),
        paymentReminderDays: Number(form.paymentReminderDays)
      });
      resource.setState({ status: "ready", data: result, error: "" });
      setNotice({ message: "Business settings saved." });
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <section className="section-block settings-section">
        {resource.status === "loading" && <LoadingRows />}
        {resource.status === "error" && <StatePanel title="Settings unavailable" message={resource.error} action={<button className="text-button" onClick={resource.reload}>Try again</button>} />}
        {resource.status === "ready" && form && (
          <form className="settings-form" onSubmit={submit}>
            <SectionHeader eyebrow="Customer service" title="Response and billing" />
            <div className="form-grid">
              <Field label="Lead response target" hint="Minutes"><input required min="1" max="1440" type="number" value={form.responseTargetMinutes} onChange={(event) => setForm({ ...form, responseTargetMinutes: event.target.value })} /></Field>
              <Field label="Hourly team rate" hint="Two-person team"><input required min="0" step="0.01" type="number" value={form.hourlyTeamRate} onChange={(event) => setForm({ ...form, hourlyTeamRate: event.target.value })} /></Field>
              <Field label="Late cancellation fee"><input required min="0" step="0.01" type="number" value={form.lateCancellationFee} onChange={(event) => setForm({ ...form, lateCancellationFee: event.target.value })} /></Field>
              <Field label="Payment reminder interval" hint="Days"><input required min="1" max="365" type="number" value={form.paymentReminderDays} onChange={(event) => setForm({ ...form, paymentReminderDays: event.target.value })} /></Field>
              <Field label="Quote review age" hint="Days"><input required min="1" max="365" type="number" value={form.quoteReviewDays} onChange={(event) => setForm({ ...form, quoteReviewDays: event.target.value })} /></Field>
            </div>
            <SectionHeader eyebrow="Dispatch and payroll" title="Route thresholds" />
            <div className="form-grid">
              <Field label="Captain reimbursement"><input required min="0" step="0.01" type="number" value={form.captainReimbursement} onChange={(event) => setForm({ ...form, captainReimbursement: event.target.value })} /></Field>
              <Field label="Long-route warning" hint="Paid minutes"><input required min="1" max="1440" type="number" value={form.routeWarningMinutes} onChange={(event) => setForm({ ...form, routeWarningMinutes: event.target.value })} /></Field>
              <Field label="Late finish warning"><input required type="time" value={form.routeWarningEndTime} onChange={(event) => setForm({ ...form, routeWarningEndTime: event.target.value })} /></Field>
            </div>
            <button className="primary-button inline-button" disabled={saving} type="submit">{saving ? "Saving..." : "Save settings"}</button>
          </form>
        )}
      </section>
    </>
  );
}

function ServiceTypesPanel() {
  const resource = useLoad(
    () => api.list("service-types", { limit: 100 }),
    []
  );
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const services = resource.data?.serviceTypes || [];

  async function setActive(service, active) {
    const verb = active ? "reactivate" : "deactivate";
    if (!window.confirm(`${capitalize(verb)} ${service.name}?`)) return;
    try {
      await api.update("service-types", service.id, { active });
      setNotice({ message: `${service.name} ${active ? "reactivated" : "deactivated"}.` });
      resource.reload();
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    }
  }

  return (
    <section className="section-block settings-section">
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <SectionHeader eyebrow="Scheduling catalog" title="Service types" count={services.length}>
        <button className="primary-button inline-button" type="button" onClick={() => setModal({})}>
          Add service
        </button>
      </SectionHeader>
      {resource.status === "loading" && <LoadingRows />}
      {resource.status === "error" && <StatePanel title="Services unavailable" message={resource.error} />}
      {resource.status === "ready" && !services.length && (
        <StatePanel title="No service types" message="Add the first service offered by the business." />
      )}
      {resource.status === "ready" && services.length > 0 && (
        <div className="data-table service-type-table">
          <div className="data-row data-head">
            <span>Service</span><span>Category</span><span>Duration</span>
            <span>Status</span><span>Actions</span>
          </div>
          {services.map((service) => (
            <article className="data-row" key={service.id}>
              <div data-label="Service">
                <strong>{service.name}</strong>
                <small>{service.referenceChecklist?.length || 0} checklist items</small>
              </div>
              <div data-label="Category">{capitalize(service.category)}</div>
              <div data-label="Duration">
                {service.defaultDurationMinutes
                  ? `${service.defaultDurationMinutes} min`
                  : "Not set"}
              </div>
              <div data-label="Status">
                <StatusBadge status={service.active ? "active" : "inactive"} />
              </div>
              <div className="row-actions" data-label="Actions">
                <button className="text-button" type="button" onClick={() => setModal({ service })}>
                  Edit
                </button>
                <button
                  className={`text-button ${service.active ? "danger-text" : ""}`}
                  type="button"
                  onClick={() => setActive(service, !service.active)}
                >
                  {service.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {modal && (
        <Modal title={modal.service ? "Edit service" : "Add service"} onClose={() => setModal(null)}>
          <ServiceTypeForm
            service={modal.service}
            onCancel={() => setModal(null)}
            onSaved={() => {
              setModal(null);
              setNotice({ message: modal.service ? "Service updated." : "Service added." });
              resource.reload();
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function ServiceTypeForm({ service, onCancel, onSaved }) {
  const [form, setForm] = useState({
    name: service?.name || "",
    category: service?.category || "residential",
    defaultDurationMinutes: service?.defaultDurationMinutes || "",
    checklist: service?.referenceChecklist?.join("\n") || ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      name: form.name,
      category: form.category,
      defaultDurationMinutes: form.defaultDurationMinutes
        ? Number(form.defaultDurationMinutes)
        : null,
      referenceChecklist: form.checklist
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
    };
    try {
      if (service) await api.update("service-types", service.id, payload);
      else await api.create("service-types", payload);
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Service name">
          <input required maxLength="150" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
            <option value="addon">Add-on</option>
          </select>
        </Field>
        <Field label="Default duration" hint="Minutes">
          <input min="1" max="1440" type="number" value={form.defaultDurationMinutes} onChange={(event) => setForm({ ...form, defaultDurationMinutes: event.target.value })} />
        </Field>
      </div>
      <Field label="Reference checklist" hint="One item per line">
        <textarea rows="6" value={form.checklist} onChange={(event) => setForm({ ...form, checklist: event.target.value })} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={service ? "Save service" : "Add service"} />
    </form>
  );
}

function AuditHistoryPanel() {
  const [form, setForm] = useState({ entityType: "", entityId: "", action: "" });
  const [query, setQuery] = useState(form);
  const resource = useLoad(
    () => api.get("/audit-events", { ...query, limit: 100 }),
    [query.entityType, query.entityId, query.action]
  );
  const events = resource.data?.events || [];

  return (
    <section className="section-block settings-section">
      <SectionHeader eyebrow="Accountability" title="Activity history" count={events.length} />
      <form className="toolbar audit-toolbar" onSubmit={(event) => {
        event.preventDefault();
        setQuery(form);
      }}>
        <input aria-label="Filter entity type" placeholder="Record type" value={form.entityType} onChange={(event) => setForm({ ...form, entityType: event.target.value })} />
        <input aria-label="Filter record ID" placeholder="Record ID" value={form.entityId} onChange={(event) => setForm({ ...form, entityId: event.target.value })} />
        <input aria-label="Filter action" placeholder="Action" value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value })} />
        <button className="secondary-button" type="submit">Filter</button>
        <button className="text-button" type="button" onClick={() => {
          const empty = { entityType: "", entityId: "", action: "" };
          setForm(empty);
          setQuery(empty);
        }}>Clear</button>
      </form>
      {resource.status === "loading" && <LoadingRows />}
      {resource.status === "error" && <StatePanel title="History unavailable" message={resource.error} />}
      {resource.status === "ready" && !events.length && (
        <StatePanel title="No activity" message="No changes match these filters." />
      )}
      {resource.status === "ready" && events.length > 0 && (
        <div className="data-table audit-table">
          <div className="data-row data-head">
            <span>When</span><span>User</span><span>Record</span><span>Action</span><span>Details</span>
          </div>
          {events.map((event) => (
            <article className="data-row" key={event.id}>
              <div data-label="When">{dateTime(event.createdAt)}</div>
              <div data-label="User">{event.actorName || "System"}</div>
              <div data-label="Record">
                <strong>{capitalize(
                  event.entityType
                    .replace(/([a-z])([A-Z])/g, "$1 $2")
                    .replaceAll("_", " ")
                )}</strong>
                <small>{event.entityId || "Batch action"}</small>
              </div>
              <div data-label="Action">
                <StatusBadge status={event.action.replaceAll("_", " ")} />
                {event.reason && <small>{event.reason}</small>}
              </div>
              <div data-label="Details">
                <details>
                  <summary>View change</summary>
                  <pre>{JSON.stringify({ before: event.before, after: event.after }, null, 2)}</pre>
                </details>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SecurityPanel() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setNotice(null);
    if (newPassword !== confirmPassword) {
      setNotice({ type: "error", message: "New passwords do not match." });
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice({ message: "Password changed. Other active sessions were signed out." });
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section-block settings-section">
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <form className="settings-form" onSubmit={submit}>
        <SectionHeader eyebrow="Account security" title="Change password" />
        <div className="form-grid">
          <Field label="Current password">
            <input
              autoComplete="current-password"
              required
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <Field label="New password" hint="At least 12 characters">
            <input
              autoComplete="new-password"
              minLength="12"
              required
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <Field label="Confirm new password">
            <input
              autoComplete="new-password"
              minLength="12"
              required
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Field>
        </div>
        <button className="primary-button inline-button" disabled={saving} type="submit">
          {saving ? "Changing..." : "Change password"}
        </button>
      </form>
    </section>
  );
}

function AccountsPanel() {
  const resource = useLoad(async () => {
    const [userData, employeeData] = await Promise.all([
      api.get("/users"),
      api.list("employees", { active: true, limit: 100 })
    ]);
    return { users: userData.users || [], employees: employeeData.employees || [] };
  }, []);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const users = resource.data?.users || [];

  return (
    <section className="section-block settings-section">
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <SectionHeader eyebrow="Access control" title="User accounts" count={users.length}>
        <button className="primary-button inline-button" type="button" onClick={() => setModal({ type: "user" })}>Add account</button>
      </SectionHeader>
      {resource.status === "loading" && <LoadingRows />}
      {resource.status === "error" && <StatePanel title="Accounts unavailable" message={resource.error} />}
      {resource.status === "ready" && users.length === 0 && <StatePanel title="No accounts" message="No manager or employee accounts are available." />}
      {resource.status === "ready" && users.length > 0 && (
        <div className="data-table account-table">
          <div className="data-row data-head"><span>User</span><span>Role</span><span>Status</span><span>Created</span><span>Actions</span></div>
          {users.map((account) => (
            <article className="data-row" key={account.id}>
              <div data-label="User"><strong>{account.name}</strong><small>{account.email}</small></div>
              <div data-label="Role">{account.role === "cleaner" ? "Employee" : "Manager"}</div>
              <div data-label="Status"><StatusBadge status={account.active ? "active" : "inactive"} /></div>
              <div data-label="Created">{shortDate(account.createdAt)}</div>
              <div className="row-actions" data-label="Actions">
                <button className="text-button" type="button" onClick={() => setModal({ type: "user", item: account })}>Edit</button>
                <button className="text-button" type="button" onClick={() => setModal({ type: "password", item: account })}>Reset password</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {modal?.type === "user" && (
        <Modal title={modal.item ? "Edit account" : "Add account"} onClose={() => setModal(null)}>
          <UserForm
            account={modal.item}
            employees={resource.data?.employees || []}
            onCancel={() => setModal(null)}
            onSaved={(message) => finishModal(message, setModal, setNotice, resource.reload)}
          />
        </Modal>
      )}
      {modal?.type === "password" && (
        <Modal title={`Reset password - ${modal.item.name}`} onClose={() => setModal(null)}>
          <PasswordResetForm
            account={modal.item}
            onCancel={() => setModal(null)}
            onSaved={() => finishModal("Password reset. Existing sessions were signed out.", setModal, setNotice, resource.reload)}
          />
        </Modal>
      )}
    </section>
  );
}

function UserForm({ account, employees, onCancel, onSaved }) {
  const [form, setForm] = useState({
    email: account?.email || "",
    name: account?.name || "",
    role: account?.role || "manager",
    password: "",
    employeeId: account?.employeeId || "",
    active: account?.active ?? true
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (account) {
        await api.patch(`/users/${account.id}`, { name: form.name, active: form.active });
      } else {
        await api.post("/users", {
          email: form.email,
          name: form.name,
          role: form.role,
          password: form.password,
          employeeId: form.role === "cleaner" ? form.employeeId : null
        });
      }
      onSaved(account ? "Account updated." : "Account created.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Name"><input required maxLength="200" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        {!account && <Field label="Email"><input required maxLength="254" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>}
        {!account && (
          <Field label="Account type" hint="Captains use employee accounts. Assign captain access under Employees > Teams.">
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value, employeeId: "" })}>
              <option value="manager">Manager</option><option value="cleaner">Employee</option>
            </select>
          </Field>
        )}
        {!account && form.role === "cleaner" && (
          <Field label="Employee">
            <select required value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })}>
              <option value="">Select employee</option>
              {employees.filter((employee) => !employee.userId).map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}
            </select>
          </Field>
        )}
        {!account && <Field label="Temporary password" hint="At least 12 characters"><input required minLength="12" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>}
        {account && (
          <Field label="Status">
            <select value={String(form.active)} onChange={(event) => setForm({ ...form, active: event.target.value === "true" })}>
              <option value="true">Active</option><option value="false">Inactive</option>
            </select>
          </Field>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel={account ? "Save changes" : "Create account"} />
    </form>
  );
}

function PasswordResetForm({ account, onCancel, onSaved }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/users/${account.id}/reset-password`, { password });
      onSaved();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="modal-form" onSubmit={submit}>
      <Field label="New temporary password" hint="At least 12 characters">
        <input required minLength="12" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <FormActions saving={saving} onCancel={onCancel} submitLabel="Reset password" />
    </form>
  );
}

function ImportsPanel() {
  const [type, setType] = useState("customers");
  const [rowsText, setRowsText] = useState("");
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  async function readFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setRowsText(await file.text());
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const rows = JSON.parse(rowsText);
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("Import file must contain a non-empty JSON array.");
      const response = await api.post(`/imports/${type}`, { rows });
      setResult(response.import);
      setNotice({ message: `${response.import.rows} rows imported.` });
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section-block settings-section">
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <SectionHeader eyebrow="Validated imports" title="Customer and employee data" />
      <form className="settings-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Import type">
            <select value={type} onChange={(event) => { setType(event.target.value); setResult(null); }}>
              <option value="customers">Customers</option><option value="employees">Employees</option>
            </select>
          </Field>
          <Field label="JSON file">
            <input accept=".json,application/json" type="file" onChange={readFile} />
          </Field>
        </div>
        <Field label="Rows JSON">
          <textarea required rows="12" spellCheck="false" value={rowsText} onChange={(event) => setRowsText(event.target.value)} />
        </Field>
        <button className="primary-button inline-button" disabled={saving} type="submit">{saving ? "Importing..." : "Run import"}</button>
      </form>
      {result && (
        <div className="metric-grid import-result">
          <Metric label="Rows" value={result.rows} />
          <Metric label="Created" value={result.created} />
          <Metric label="Updated" value={result.updated} />
          {result.propertiesCreated !== undefined && <Metric label="Properties" value={result.propertiesCreated} />}
        </div>
      )}
    </section>
  );
}

function NotFoundPage() {
  return (
    <>
      <PageHeader eyebrow="Operations" title="Page not found" description="The requested operations page does not exist." />
      <section className="section-block"><StatePanel title="Return to dashboard" message="Use the primary navigation to continue." /></section>
    </>
  );
}

function finishModal(message, setModal, setNotice, reload) {
  setModal(null);
  setNotice({ message });
  reload();
}

async function loadAllRows(path, query, key) {
  const rows = [];
  let offset = 0;
  let total = 0;
  do {
    const response = await api.get(path, { ...query, limit: 100, offset });
    const page = response[key] || [];
    rows.push(...page);
    total = Number(response.pagination?.total ?? rows.length);
    offset += page.length;
    if (!page.length) break;
  } while (offset < total);
  return rows;
}

function downloadTableCsv({ filename, columns, rows }) {
  const escape = (value) => {
    const text = value == null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = [
    columns.map(escape).join(","),
    ...rows.map((row) => row.map(escape).join(","))
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function errorMessage(error) {
  if (error instanceof ApiError && error.status === 401) return "Your session has expired. Refresh and sign in again.";
  const issue = error instanceof ApiError && error.code === "validation_error"
    ? error.details?.issues?.[0]
    : null;
  if (issue) {
    const path = issue.path || [];
    const row = path[0] === "rows" && Number.isInteger(path[1]) ? `Row ${path[1] + 1} ` : "";
    const field = String(path.at(-1) || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (letter) => letter.toUpperCase());
    return `${row}${field ? `${field}: ` : ""}${issue.message}`;
  }
  return error?.message || "The request could not be completed.";
}

function money(value) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) / 100);
}

function percentage(value, literal = false) {
  if (value === null || value === undefined) return "-";
  const number = Number(value);
  const normalized = !literal && Math.abs(number) <= 1 ? number * 100 : number;
  return `${normalized.toFixed(1)}%`;
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function clock(value) {
  if (!value) return "Flexible";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function dateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function shortDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`));
}

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function hours(minutes) {
  return `${(Number(minutes || 0) / 60).toFixed(2)} hr`;
}

function mondayFor(value) {
  const date = new Date(value);
  const day = date.getDay();
  date.setDate(date.getDate() - ((day + 6) % 7));
  return localDate(date);
}

function downloadCsv(payrollExport) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = [
    payrollExport.columns.map(escape).join(","),
    ...payrollExport.rows.map((row) => row.map(escape).join(","))
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `queen-city-maid-payroll-${payrollExport.period.startsOn}-v${payrollExport.version}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(date);
}

function duration(minutes) {
  if (!minutes) return "Duration not set";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours && `${hours} hr`, remainder && `${remainder} min`].filter(Boolean).join(" ");
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function nextScheduleDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return date.getDay() === 0 ? shiftDate(value, 1) : value;
}

function recurrenceLabel(rule = {}) {
  if (rule.type === "dates") {
    return `${rule.dates?.length || 0} individual date${rule.dates?.length === 1 ? "" : "s"}`;
  }
  if (rule.type === "weekly") {
    return rule.intervalWeeks === 1 ? "Weekly" : `Every ${rule.intervalWeeks} weeks`;
  }
  if (rule.type === "monthly") return `Monthly on day ${rule.dayOfMonth}`;
  if (rule.type === "nth_weekday") {
    const ordinal = ["", "1st", "2nd", "3rd", "4th", "5th"][rule.occurrence] || rule.occurrence;
    const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][rule.weekday];
    return `${ordinal} ${weekday} each month`;
  }
  return "Custom frequency";
}

function capitalize(value = "") {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function paymentMethodLabel(value) {
  if (!value) return "Payment method not set";
  return value === "paypal" ? "PayPal" : capitalize(value);
}
