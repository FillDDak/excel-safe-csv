"""Prints the cells of the first sheet of an .xlsx file as JSON: [[[value, type], ...], ...]."""
import datetime
import json
import sys

import openpyxl

sheet = openpyxl.load_workbook(sys.argv[1], data_only=True).active
rows = []
for row in sheet.iter_rows():
    cells = []
    for cell in row:
        value = cell.value
        if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
            value = value.isoformat()
        cells.append([value, type(cell.value).__name__])
    rows.append(cells)
print(json.dumps(rows))
