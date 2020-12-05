import os
import numpy as np
files = [f for f in os.listdir('.') if os.path.isfile(f) and '.obj' in f]
f = open("dir_details.txt","a")
f.truncate(0)
string_literal = "'"+','.join(list(files))+"'"
f.write(string_literal)
f.close()