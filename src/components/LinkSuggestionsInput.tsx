import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "tg_recent_links";
const MAX_LINKS = 20;

export function getRecentLinks(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveLink(link: string) {
  if (!link.trim()) return;
  const links = getRecentLinks().filter((l) => l !== link.trim());
  links.unshift(link.trim());
  localStorage.setItem(STORAGE_KEY, JSON.stringify(links.slice(0, MAX_LINKS)));
}

interface LinkSuggestionsInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function LinkSuggestionsInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: LinkSuggestionsInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleFocus = () => {
    const links = getRecentLinks();
    if (links.length > 0) {
      setSuggestions(links);
      setShowSuggestions(true);
    }
  };

  const handleChange = (val: string) => {
    onChange(val);
    const links = getRecentLinks();
    const filtered = val.trim()
      ? links.filter((l) => l.toLowerCase().includes(val.toLowerCase()))
      : links;
    setSuggestions(filtered);
    setShowSuggestions(filtered.length > 0);
  };

  const handleSelect = (link: string) => {
    onChange(link);
    setShowSuggestions(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={handleFocus}
        placeholder={placeholder}
        disabled={disabled}
        dir="ltr"
        className={cn("text-left", className)}
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-popover border rounded-md shadow-lg max-h-40 overflow-auto">
          {suggestions.map((link, i) => (
            <button
              key={i}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b last:border-b-0"
              onClick={() => handleSelect(link)}
              dir="ltr"
            >
              {link}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
