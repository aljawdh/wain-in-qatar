export default function Loading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center px-6 py-12">
      <div className="inline-flex items-center gap-3 rounded-3xl border border-maroon/20 bg-white px-6 py-4 shadow-soft">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-maroon border-t-transparent" />
        <span className="text-sm font-medium text-slate-700">Loading...</span>
      </div>
    </div>
  );
}
