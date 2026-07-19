"use client";

import { useState } from "react";
import IconPicker from "./IconPicker";
import {
  MAX_PROFILES,
  SupabaseAccount,
  SupabaseProfile,
  createProfile,
  updateProfile,
  deleteProfile,
} from "./utils/supabase";

interface ProfilePageProps {
  account: SupabaseAccount;
  profiles: SupabaseProfile[];
  onProfilesChange: (profiles: SupabaseProfile[]) => void;
  onSelectProfile: (profile: SupabaseProfile) => void;
  onLogout: () => void;
}

type ModalState = { mode: "create" } | { mode: "edit"; profile: SupabaseProfile } | null;

export default function ProfilePage({ account, profiles, onProfilesChange, onSelectProfile, onLogout }: ProfilePageProps) {
  const [modal, setModal] = useState<ModalState>(null);
  const [manageMode, setManageMode] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const closeModal = () => setModal(null);

  const handleSaved = (updated: SupabaseProfile[]) => {
    onProfilesChange(updated);
    closeModal();
  };

  // Brief glow-then-fade before actually switching, instead of an instant
  // cut — gives the selection a sense of weight instead of feeling abrupt.
  const handleSelect = (profile: SupabaseProfile) => {
    if (selectingId) return; // ignore double-clicks mid-transition
    setSelectingId(profile.id);
    window.setTimeout(() => onSelectProfile(profile), 260);
  };

  return (
    <div
      className={`min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center px-4 py-12 transition-opacity duration-300 ${
        selectingId ? "opacity-0" : "opacity-100"
      }`}
    >
      <h1 className="text-2xl md:text-3xl font-black tracking-tight mb-2">Who's Watching?</h1>
      <p className="text-xs font-mono uppercase tracking-widest text-neutral-500 mb-10">{account.username}</p>

      <div className="flex flex-wrap justify-center gap-6 max-w-[30rem]">
        {profiles.map((profile) => (
          <ProfileBox
            key={profile.id}
            profile={profile}
            manageMode={manageMode}
            selected={selectingId === profile.id}
            onClick={() => (manageMode ? setModal({ mode: "edit", profile }) : handleSelect(profile))}
          />
        ))}

        {profiles.length < MAX_PROFILES && !manageMode && (
          <button
            onClick={() => setModal({ mode: "create" })}
            className="w-28 sm:w-32 flex flex-col items-center space-y-2 group cursor-pointer transition-transform duration-200 hover:-translate-y-1"
          >
            <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-lg border-2 border-dashed border-neutral-700 flex items-center justify-center text-4xl text-neutral-600 group-hover:border-orange-500 group-hover:text-orange-500 transition-colors duration-200">
              +
            </div>
            <span className="text-xs font-mono uppercase tracking-widest text-neutral-500 group-hover:text-neutral-300 transition-colors duration-200">
              Add Profile
            </span>
          </button>
        )}
      </div>

      <div className="flex items-center space-x-6 mt-12">
        <button
          onClick={() => setManageMode((m) => !m)}
          className="text-xs font-mono uppercase tracking-widest text-neutral-500 hover:text-neutral-200 border border-neutral-800 hover:border-neutral-600 rounded px-4 py-2 transition duration-200 hover:scale-[1.03] cursor-pointer"
        >
          {manageMode ? "Done" : "Manage Profiles"}
        </button>
        <button
          onClick={onLogout}
          className="text-xs font-mono uppercase tracking-widest text-neutral-500 hover:text-red-400 border border-neutral-800 hover:border-red-900 rounded px-4 py-2 transition duration-200 hover:scale-[1.03] cursor-pointer"
        >
          Log Out
        </button>
      </div>

      {modal && (
        <ProfileModal
          account={account}
          profiles={profiles}
          modal={modal}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function ProfileBox({
  profile,
  manageMode,
  selected,
  onClick,
}: {
  profile: SupabaseProfile;
  manageMode: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-28 sm:w-32 flex flex-col items-center space-y-2 group cursor-pointer transition-transform duration-200 ${
        selected ? "scale-105" : "hover:-translate-y-1 hover:scale-[1.03]"
      }`}
    >
      <div
        className={`relative w-28 h-28 sm:w-32 sm:h-32 rounded-lg overflow-hidden border-2 transition-all duration-200 ${
          selected
            ? "border-orange-500 shadow-[0_0_24px_4px_rgba(249,115,22,0.45)]"
            : manageMode
            ? "border-neutral-600"
            : "border-transparent group-hover:border-orange-500 group-hover:shadow-[0_0_16px_2px_rgba(249,115,22,0.25)]"
        }`}
      >
        <img src={profile.avatar_url} alt={profile.name} className="w-full h-full object-cover bg-neutral-900" />
        {manageMode && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-2xl">✎</span>
          </div>
        )}
        {profile.is_kids && (
          <span className="absolute bottom-1 left-1 right-1 text-center text-[9px] font-bold uppercase tracking-wider bg-orange-500/90 rounded py-0.5">
            Kids
          </span>
        )}
      </div>
      <span className="text-xs font-mono text-neutral-400 group-hover:text-neutral-200 transition-colors duration-200 truncate max-w-full">
        {profile.name}
      </span>
    </button>
  );
}

function ProfileModal({
  account,
  profiles,
  modal,
  onClose,
  onSaved,
}: {
  account: SupabaseAccount;
  profiles: SupabaseProfile[];
  modal: Exclude<ModalState, null>;
  onClose: () => void;
  onSaved: (profiles: SupabaseProfile[]) => void;
}) {
  const editing = modal.mode === "edit" ? modal.profile : null;
  const [name, setName] = useState(editing?.name || "");
  const [icon, setIcon] = useState(editing?.avatar_url || "");
  const [isKids, setIsKids] = useState(editing?.is_kids || false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (editing) {
        await updateProfile(editing.id, { name: name.trim(), avatar_url: icon, is_kids: isKids });
        onSaved(profiles.map((p) => (p.id === editing.id ? { ...p, name: name.trim(), avatar_url: icon, is_kids: isKids } : p)));
      } else {
        const created = await createProfile(account.id, name, icon, isKids);
        onSaved([...profiles, created]);
      }
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!confirm(`Delete the profile "${editing.name}"? This can't be undone.`)) return;
    setSubmitting(true);
    try {
      await deleteProfile(editing.id);
      onSaved(profiles.filter((p) => p.id !== editing.id));
    } catch (err: any) {
      setError(err?.message || "Couldn't delete this profile.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-5"
      >
        <h2 className="text-lg font-black tracking-tight">{editing ? "Edit Profile" : "Add Profile"}</h2>

        <div className="space-y-1.5">
          <label className="text-[11px] font-mono uppercase tracking-widest text-neutral-500">Profile Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={20}
            className="w-full px-3 py-2 rounded-md bg-neutral-950 border border-neutral-800 text-sm focus:outline-none focus:border-orange-500"
            placeholder="e.g. Alex"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-mono uppercase tracking-widest text-neutral-500">Choose an Icon</label>
          <IconPicker value={icon} onChange={setIcon} />
        </div>

        <div className="flex items-center justify-between bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold">Kids Profile</p>
            <p className="text-[11px] text-neutral-500">Hides mature/adult-tagged content</p>
          </div>
          <button
            type="button"
            onClick={() => setIsKids((v) => !v)}
            className={`w-11 h-6 rounded-full transition relative shrink-0 cursor-pointer ${isKids ? "bg-orange-500" : "bg-neutral-700"}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition ${isKids ? "left-5" : "left-0.5"}`} />
          </button>
        </div>

        {error && (
          <p className="text-xs font-mono text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">{error}</p>
        )}

        <div className="flex items-center space-x-3">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 py-2.5 rounded-md bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-sm font-bold uppercase tracking-widest transition cursor-pointer"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-md border border-neutral-800 hover:border-neutral-600 text-sm font-semibold transition cursor-pointer"
          >
            Cancel
          </button>
        </div>

        {editing && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="w-full text-xs font-mono uppercase tracking-widest text-neutral-500 hover:text-red-400 transition cursor-pointer"
          >
            Delete Profile
          </button>
        )}
      </form>
    </div>
  );
}