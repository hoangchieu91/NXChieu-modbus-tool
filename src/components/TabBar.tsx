import React, { useState, useRef, useEffect } from 'react';
import { X, Plus, Radio, Shield, Edit2, ChevronDown } from 'lucide-react';
import { TabSession } from '../types/modbus';

interface TabBarProps {
  tabs: TabSession[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onAddTab: () => void;
  onRenameTab: (id: string, newTitle: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onRenameTab,
}) => {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Focus and select all on start rename
  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  // Click outside dropdown to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  // Keyboard navigation: Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1..9
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        if (currentIndex !== -1) {
          const nextIndex = e.shiftKey
            ? (currentIndex - 1 + tabs.length) % tabs.length
            : (currentIndex + 1) % tabs.length;
          onSelectTab(tabs[nextIndex].id);
        }
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
        const targetIndex = parseInt(e.key, 10) - 1;
        if (targetIndex < tabs.length) {
          e.preventDefault();
          onSelectTab(tabs[targetIndex].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId, onSelectTab]);

  const startRename = (tab: TabSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditingTitle(tab.title);
  };

  const commitRename = (tabId: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed.length > 0) {
      onRenameTab(tabId, trimmed);
    }
    setEditingTabId(null);
  };

  return (
    <div className="flex items-center justify-between px-2 bg-slate-950 border-b border-slate-800 text-xs select-none">
      {/* Tab Items List */}
      <div className="flex items-center space-x-1 py-1 overflow-x-auto scrollbar-none flex-1">
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeTabId;
          const isSlave = tab.role === 'slave';
          const isEditing = editingTabId === tab.id;

          let subtitle = '';
          if (isSlave) {
            subtitle = `Slave [${tab.slaveTable?.toUpperCase() || 'HOLDING'}]`;
          } else {
            const fcName =
              tab.definition.function_code === 1
                ? 'Coils'
                : tab.definition.function_code === 2
                ? 'Discretes'
                : tab.definition.function_code === 3
                ? 'Holding'
                : 'Input';
            subtitle = `Master ID:${tab.definition.slave_id} (${fcName})`;
          }

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onDoubleClick={(e) => startRename(tab, e)}
              className={`group flex items-center space-x-2 px-3 py-1.5 rounded-t border-t border-x cursor-pointer transition-all shrink-0 ${
                isActive
                  ? isSlave
                    ? 'bg-slate-900 border-amber-600/60 text-amber-300 font-medium shadow-sm'
                    : 'bg-slate-900 border-slate-700 text-cyan-300 font-medium shadow-sm'
                  : 'bg-slate-950/60 border-transparent text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
              }`}
              title="Nhấp đúp chuột để đổi tên Sheet (hoặc bấm biểu tượng bút chì). Nhấn Ctrl+1..9 để chuyển nhanh"
            >
              {isSlave ? (
                <Shield className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-amber-400' : 'text-slate-500'}`} />
              ) : (
                <Radio className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
              )}

              {/* Sheet Number Shortcut indicator */}
              {idx < 9 && (
                <span className="text-[9px] font-mono text-slate-500 opacity-60 group-hover:opacity-100">
                  ^{idx + 1}
                </span>
              )}

              {/* Title / Inline Rename Input */}
              {isEditing ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(tab.id);
                    if (e.key === 'Escape') setEditingTabId(null);
                  }}
                  onBlur={() => commitRename(tab.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-slate-950 text-cyan-300 border border-cyan-400 px-1 py-0.5 rounded text-xs font-semibold focus:outline-none min-w-[90px]"
                />
              ) : (
                <span className="font-semibold text-slate-200 hover:text-cyan-200 transition-colors">
                  {tab.title}
                </span>
              )}

              {/* Role/Table badge */}
              <span
                className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                  isSlave
                    ? 'bg-amber-950/60 text-amber-400 border border-amber-800/40'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {subtitle}
              </span>

              {/* Rename icon button on hover */}
              {!isEditing && (
                <button
                  onClick={(e) => startRename(tab, e)}
                  className="p-0.5 rounded hover:bg-slate-800 text-slate-500 hover:text-cyan-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Đổi tên Sheet (Rename)"
                >
                  <Edit2 className="w-2.5 h-2.5" />
                </button>
              )}

              {/* Close Tab button */}
              {tabs.length > 1 && (
                <button
                  onClick={(e) => onCloseTab(tab.id, e)}
                  className="p-0.5 rounded hover:bg-slate-800 text-slate-500 hover:text-rose-400 opacity-50 group-hover:opacity-100 transition-opacity"
                  title="Đóng sheet"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* Add New Tab Button */}
        <button
          onClick={onAddTab}
          className="p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors shrink-0"
          title="Thêm Sheet mới (+)"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Fast Sheet Switcher Dropdown */}
      <div className="relative shrink-0 ml-2" ref={dropdownRef}>
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center space-x-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors text-[11px]"
          title="Danh sách tất cả các Sheet (Chuyển đổi nhanh)"
        >
          <span>Sheets ({tabs.length})</span>
          <ChevronDown className="w-3 h-3 text-slate-400" />
        </button>

        {isDropdownOpen && (
          <div className="absolute right-0 top-full mt-1 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 z-50 max-h-72 overflow-y-auto">
            <div className="px-3 py-1 text-[10px] text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-800">
              Chuyển nhanh Sheet (Phím tắt: Ctrl+1..9)
            </div>
            {tabs.map((t, idx) => (
              <button
                key={t.id}
                onClick={() => {
                  onSelectTab(t.id);
                  setIsDropdownOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 flex items-center justify-between text-xs hover:bg-slate-800 transition-colors ${
                  t.id === activeTabId ? 'text-cyan-300 font-bold bg-slate-800/60' : 'text-slate-300'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  <span className="font-mono text-[10px] text-slate-500">#{idx + 1}</span>
                  <span className="truncate">{t.title}</span>
                </div>
                <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                  t.role === 'slave' ? 'bg-amber-950 text-amber-400' : 'bg-slate-800 text-cyan-400'
                }`}>
                  {t.role.toUpperCase()}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
