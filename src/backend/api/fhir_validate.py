"""FHIR R4 bundle profile conformance validation (v3 M-V5).

A bundle that is merely *shaped* like FHIR is not interoperable. This module
checks a built bundle against the constraints declared in
``fhir/StructureDefinition-bloomcast-alert.json`` plus the R4 invariants those
constraints lean on, and returns a named-issue report.

Scope, stated plainly so nobody over-reads the result:

* This is a **structural conformance check**, not a full HL7 FHIR Validator.
  It checks required resources and elements, id/reference shape, datatype
  forms, bound-value codes and the profile's declared extensions. It does not
  check terminology-server bindings, cardinality across every inherited R4
  element, or profile resolution over the wire.
* It is deliberately dependency-free. The free tier ships no Java validator and
  pulling one in would breach the no-card/no-heavy-dep guarantee, so the subset
  that matters for this profile is implemented here and stated as a subset.
* An empty ``issues`` list means "passed the checks listed in ``checked``",
  which is exactly what the UI badge claims. It is not full R4 certification.
"""
import re

# FHIR R4 id pattern: [A-Za-z0-9\-\.]{1,64}
ID_RE = re.compile(r"^[A-Za-z0-9\-\.]{1,64}$")

# Extensions the profile declares as required (min 1), mapped to value[x] key.
REQUIRED_EXTENSIONS = {
    "model-version": "valueString",
    "lead-time-days": "valueInteger",
}

# Declared optional (min 0), still type-checked when present.
OPTIONAL_EXTENSIONS = {
    "confidence-low": "valueDecimal",
    "confidence-high": "valueDecimal",
}

COMMUNICATION_STATUS = {"preparation", "in-progress", "not-done",
                        "on-hold", "stopped", "completed", "entered-in-error", "unknown"}
OBSERVATION_STATUS = {"registered", "preliminary", "final", "amended",
                      "corrected", "cancelled", "entered-in-error", "unknown"}
BUNDLE_TYPE = {"document", "message", "transaction", "transaction-response",
               "batch", "batch-response", "history", "searchset", "collection",
               "subscription-notification"}

ISO_DATETIME = re.compile(
    r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$"
)

CHECKED = [
    "Bundle.resourceType / type / timestamp",
    "resource.id matches the R4 id pattern",
    "Communication.status / subject / sent / payload",
    "Observation.status / code / valueQuantity within [0,1]",
    "Location.position coordinate ranges",
    f"required extensions {sorted(REQUIRED_EXTENSIONS)}",
    f"optional extensions {sorted(OPTIONAL_EXTENSIONS)}",
    "intra-bundle reference resolution",
]


def _issue(issues, path, message):
    issues.append({"path": path, "message": message})


def _check_resource(resource, issues, where):
    """Invariants every resource in this bundle must satisfy."""
    rtype = resource.get("resourceType")
    if not rtype:
        _issue(issues, where, "resource has no resourceType")
        return
    rid = resource.get("id")
    if not rid:
        _issue(issues, f"{where}.id", f"{rtype} is missing a required id")
    elif not ID_RE.match(str(rid)):
        _issue(issues, f"{where}.id",
               f"id {rid!r} does not match the FHIR id pattern [A-Za-z0-9-.]{{1,64}}")

    if rtype == "Communication":
        status = resource.get("status")
        if not status:
            _issue(issues, f"{where}.status", "Communication.status is required")
        elif status not in COMMUNICATION_STATUS:
            _issue(issues, f"{where}.status",
                   f"status {status!r} is not a bound Communication status code")
        if not resource.get("subject"):
            _issue(issues, f"{where}.subject",
                   "Communication.subject is required and must reference the Location")
        if not resource.get("sent"):
            _issue(issues, f"{where}.sent", "Communication.sent is required")
        if not resource.get("payload"):
            _issue(issues, f"{where}.payload",
                   "Communication.payload is required by the profile (min 1)")

    elif rtype == "Observation":
        status = resource.get("status")
        if not status:
            _issue(issues, f"{where}.status", "Observation.status is required")
        elif status not in OBSERVATION_STATUS:
            _issue(issues, f"{where}.status",
                   f"status {status!r} is not a bound Observation status code")
        if not resource.get("code"):
            _issue(issues, f"{where}.code", "Observation.code is required")
        value = resource.get("valueQuantity")
        if not isinstance(value, dict) or not isinstance(value.get("value"), (int, float)):
            _issue(issues, f"{where}.valueQuantity",
                   "Observation.valueQuantity.value must be a number")
        elif not 0.0 <= float(value["value"]) <= 1.0:
            _issue(issues, f"{where}.valueQuantity.value",
                   f"probability {value['value']} is outside [0, 1]")
        effective = resource.get("effectiveDateTime")
        if effective and not ISO_DATETIME.match(str(effective)):
            _issue(issues, f"{where}.effectiveDateTime",
                   f"{effective!r} is not a valid FHIR dateTime")

    elif rtype == "Location":
        position = resource.get("position")
        if not isinstance(position, dict):
            _issue(issues, f"{where}.position", "Location.position is required")
        else:
            lon, lat = position.get("longitude"), position.get("latitude")
            if not isinstance(lon, (int, float)) or not -180 <= float(lon) <= 180:
                _issue(issues, f"{where}.position.longitude",
                       f"longitude {lon!r} is out of range")
            if not isinstance(lat, (int, float)) or not -90 <= float(lat) <= 90:
                _issue(issues, f"{where}.position.latitude",
                       f"latitude {lat!r} is out of range")



def _check_extensions(resource, issues, where):
    """Every extension the profile declares must be present and well-typed."""
    by_slug: dict = {}
    for ext in resource.get("extension") or []:
        slug = str(ext.get("url") or "").rsplit("/", 1)[-1]
        if slug in REQUIRED_EXTENSIONS or slug in OPTIONAL_EXTENSIONS:
            by_slug[slug] = ext
    for slug, value_key in REQUIRED_EXTENSIONS.items():
        ext = by_slug.get(slug)
        if ext is None:
            _issue(issues, f"{where}.extension:{slug}",
                   f"required profile extension '{slug}' is missing")
        elif value_key not in ext or ext[value_key] in (None, ""):
            _issue(issues, f"{where}.extension:{slug}",
                   f"extension '{slug}' must carry a {value_key}")
    for slug, value_key in OPTIONAL_EXTENSIONS.items():
        ext = by_slug.get(slug)
        if ext is not None and value_key not in ext:
            _issue(issues, f"{where}.extension:{slug}",
                   f"extension '{slug}' must carry a {value_key}")


def validate_bundle(bundle) -> dict:
    """Validate a bundle against the BloomCast alert profile.

    Returns ``{"ok": bool, "issues": [...], "checked": [...]}``. Never raises on
    malformed input: a bundle that cannot even be read is reported invalid with
    a named issue, because "invalid input fails with named issues, never
    silently" is the contract this replaces.
    """
    issues: list = []

    if not isinstance(bundle, dict):
        return {
            "ok": False,
            "issues": [{"path": "$", "message": "bundle is not a JSON object"}],
            "checked": CHECKED,
        }
    if bundle.get("resourceType") != "Bundle":
        _issue(issues, "$.resourceType",
               f"expected 'Bundle', found {bundle.get('resourceType')!r}")
    if bundle.get("type") not in BUNDLE_TYPE:
        _issue(issues, "$.type",
               f"type {bundle.get('type')!r} is not a valid Bundle.type value")
    timestamp = bundle.get("timestamp")
    if timestamp and not ISO_DATETIME.match(str(timestamp)):
        _issue(issues, "$.timestamp", f"{timestamp!r} is not a valid FHIR dateTime")

    entries = bundle.get("entry")
    if not isinstance(entries, list) or not entries:
        return {
            "ok": False,
            "issues": issues + [{"path": "$.entry",
                                "message": "Bundle.entry is required and must be non-empty"}],
            "checked": CHECKED,
        }

    present_ids: set = set()
    resources: list = []
    for i, entry in enumerate(entries):
        where = f"$.entry[{i}]"
        resource = entry.get("resource") if isinstance(entry, dict) else None
        if not isinstance(resource, dict):
            _issue(issues, where, "entry is missing a resource object")
            continue
        _check_resource(resource, issues, where)
        resources.append((where, resource))
        rid = resource.get("id")
        if rid:
            present_ids.add(f"{resource.get('resourceType')}/{rid}")
        if resource.get("resourceType") == "Communication":
            _check_extensions(resource, issues, where)

    # Every intra-bundle reference must resolve. A dangling reference is the
    # classic interoperability failure: the bundle parses, the consumer 404s.
    for where, resource in resources:
        ref = (resource.get("subject") or {}).get("reference")
        if ref and "/" in ref and ref not in present_ids:
            _issue(issues, f"{where}.subject.reference",
                   f"reference {ref!r} does not resolve to a resource in this bundle")

    if not any(r.get("resourceType") == "Communication" for _, r in resources):
        _issue(issues, "$.entry", "bundle contains no Communication resource")

    return {"ok": not issues, "issues": issues, "checked": CHECKED}
